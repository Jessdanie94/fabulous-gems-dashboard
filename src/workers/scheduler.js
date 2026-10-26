/**
 * Minimal self-scheduling task runner.
 *
 * Why not setInterval? A self-scheduling `setTimeout` loop only arms the next timer after the
 * current run finishes (or times out), so a slow task can never pile up overlapping runs.
 *
 * Per-task options:
 *   name          unique task name (used in logs)
 *   intervalMs    delay between the end of one run and the start of the next
 *   initialDelayMs / jitterMs   first run happens after initialDelayMs + random(0..jitterMs)
 *   enabled       disabled tasks are never scheduled
 *   timeoutMs     a run exceeding this is recorded as a failure and its AbortSignal is aborted
 *   maxBackoffMs  cap for exponential backoff after consecutive failures
 *   run(ctx)      async function; ctx = { signal, logger, alert, attempt }
 *
 * Guarantees:
 *   - No overlap: an in-process lock is held until the run really settles (even after a timeout);
 *     ticks that find the lock held are skipped and logged.
 *   - Error isolation: every tick is wrapped in try/catch; a failing task never crashes the
 *     process nor affects other tasks.
 *   - Backoff: after n consecutive failures the next delay is min(maxBackoffMs, intervalMs * 2^n);
 *     a success resets it.
 *   - The scheduling timer is unref()ed (it never keeps the process alive by itself; run.js holds the loop
 *     open). Per-run timeout and shutdown timers are bounded and intentionally NOT unref()ed.
 *   - stop(): stops scheduling, aborts in-flight runs and waits for them up to a timeout.
 */

export function computeBackoffDelay(intervalMs, consecutiveFailures, maxBackoffMs) {
  if (consecutiveFailures <= 0) return intervalMs;
  const delay = intervalMs * 2 ** Math.min(consecutiveFailures, 30);
  return Math.min(Math.max(maxBackoffMs, intervalMs), delay);
}

export class Scheduler {
  /**
   * @param {{ logger: object, onFailure?: Function, alert?: Function, random?: () => number }} options
   */
  constructor({ logger, onFailure, alert, random = Math.random }) {
    this.logger = logger;
    this.onFailure = onFailure;
    this.alert = alert || (async () => {});
    this.random = random;
    this.tasks = new Map();
    this.stopped = true;
  }

  register(task) {
    if (!task?.name || typeof task.run !== "function") {
      throw new Error("Task requires a name and a run function");
    }
    if (this.tasks.has(task.name)) throw new Error(`Duplicate task name: ${task.name}`);
    this.tasks.set(task.name, {
      task: {
        initialDelayMs: 0,
        jitterMs: 0,
        timeoutMs: 60000,
        maxBackoffMs: 3600000,
        enabled: true,
        ...task,
      },
      running: false,
      failures: 0,
      timer: null,
      inflight: null,
      controller: null,
    });
  }

  start() {
    this.stopped = false;
    for (const state of this.tasks.values()) {
      if (!state.task.enabled) {
        this.logger.info("task_disabled", { task: state.task.name });
        continue;
      }
      const delay = state.task.initialDelayMs + Math.floor(this.random() * state.task.jitterMs);
      this.#schedule(state, delay);
    }
  }

  #schedule(state, delayMs) {
    if (this.stopped) return;
    state.timer = setTimeout(() => this.#tick(state), delayMs);
    state.timer.unref?.();
  }

  /** Run one tick immediately (used by tests and for manual triggering). */
  async runOnce(name) {
    const state = this.tasks.get(name);
    if (!state) throw new Error(`Unknown task: ${name}`);
    return this.#execute(state);
  }

  async #tick(state) {
    state.timer = null;
    if (this.stopped) return;
    try {
      await this.#execute(state);
    } catch (error) {
      this.logger.error("scheduler_internal_error", { task: state.task.name, error });
    }
    const { task } = state;
    this.#schedule(state, computeBackoffDelay(task.intervalMs, state.failures, task.maxBackoffMs));
  }

  async #execute(state) {
    const { task } = state;
    if (state.running) {
      this.logger.warn("task_skipped_overlap", { task: task.name });
      return { outcome: "skipped" };
    }

    state.running = true;
    const attempt = state.failures + 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    state.controller = controller;
    let timeoutTimer;

    const runPromise = Promise.resolve().then(() =>
      task.run({
        signal: controller.signal,
        logger: this.logger,
        attempt,
        alert: (key, message, details) => this.alert(`${task.name}:${key}`, message, details),
      }),
    );
    state.inflight = runPromise
      .catch(() => {})
      .finally(() => {
        state.running = false;
        state.inflight = null;
      });

    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        const error = new Error(`Task ${task.name} timed out after ${task.timeoutMs}ms`);
        error.code = "TASK_TIMEOUT";
        controller.abort(error);
        reject(error);
      }, task.timeoutMs);
    });

    try {
      const result = await Promise.race([runPromise, timeoutPromise]);
      state.failures = 0;
      this.logger.info("task_completed", {
        task: task.name,
        outcome: "success",
        attempt,
        durationMs: Date.now() - startedAt,
        result,
      });
      return { outcome: "success", result };
    } catch (error) {
      state.failures += 1;
      this.logger.error("task_failed", {
        task: task.name,
        outcome: "failure",
        attempt,
        consecutiveFailures: state.failures,
        durationMs: Date.now() - startedAt,
        nextDelayMs: computeBackoffDelay(task.intervalMs, state.failures, task.maxBackoffMs),
        error,
      });
      try {
        await this.onFailure?.(task, error, state.failures);
      } catch (hookError) {
        this.logger.error("failure_hook_error", { task: task.name, error: hookError });
      }
      return { outcome: "failure", error };
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  /** Stop scheduling and wait for in-flight runs (bounded by timeoutMs). */
  async stop({ timeoutMs = 15000 } = {}) {
    this.stopped = true;
    const pending = [];
    for (const state of this.tasks.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      if (state.inflight) {
        state.controller?.abort(new Error("Shutting down"));
        pending.push(state.inflight);
      }
    }
    if (pending.length === 0) return { timedOut: false };

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const result = await Promise.race([Promise.allSettled(pending), timeout]);
    clearTimeout(timer);
    const timedOut = result === "timeout";
    this.logger.info("scheduler_stopped", { timedOut, inflight: pending.length });
    return { timedOut };
  }
}
