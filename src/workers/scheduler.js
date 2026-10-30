/**
 * Lightweight in-process scheduler (no external dependencies).
 *
 * Guarantees for every registered worker:
 *  - runs are chained with setTimeout (never setInterval) so they cannot pile up;
 *  - an in-flight lock prevents overlapping runs (manual or scheduled);
 *  - every run is wrapped in try/catch, so errors never reach the main process;
 *  - after failures the next run is delayed with exponential backoff + full jitter;
 *  - interval / enabled flag are re-evaluated (from env) on every run;
 *  - stop() clears timers and awaits in-flight runs.
 */
import { createLogger } from "./logger.js";

export function computeBackoff(attempt, { baseMs = 1000, maxMs = 300000, random = Math.random } = {}) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(random() * ceiling);
}

export class Scheduler {
  constructor({ logger = createLogger(), random = Math.random, now = () => Date.now() } = {}) {
    this.logger = logger;
    this.random = random;
    this.now = now;
    this.workers = new Map();
    this.started = false;
    this.stopping = false;
  }

  /**
   * def: { name, description?, run(ctx), intervalMs: number | () => number,
   *        enabled?: () => boolean, initialDelayMs?, backoffBaseMs?, backoffMaxMs? }
   * run() may return { skipped: true, reason } to signal a no-op (e.g. missing secret).
   */
  register(def) {
    if (!def?.name || typeof def.run !== "function") {
      throw new Error("Worker requires a name and a run function");
    }
    if (this.workers.has(def.name)) {
      throw new Error(`Worker already registered: ${def.name}`);
    }
    this.workers.set(def.name, {
      def,
      timer: null,
      inFlight: null,
      status: {
        name: def.name,
        description: def.description || "",
        enabled: null,
        running: false,
        runCount: 0,
        consecutiveFailures: 0,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        lastResult: null,
        nextRunAt: null,
      },
    });
    if (this.started) this.#schedule(this.workers.get(def.name), def.initialDelayMs ?? 0);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    for (const entry of this.workers.values()) {
      this.#schedule(entry, entry.def.initialDelayMs ?? 0);
    }
  }

  #isEnabled(entry) {
    try {
      return entry.def.enabled ? Boolean(entry.def.enabled()) : true;
    } catch {
      return false;
    }
  }

  #interval(entry) {
    let value;
    try {
      value = typeof entry.def.intervalMs === "function" ? entry.def.intervalMs() : entry.def.intervalMs;
    } catch {
      value = undefined;
    }
    return Number.isFinite(value) && value >= 1000 ? value : 60000;
  }

  #schedule(entry, delayMs) {
    if (this.stopping) return;
    clearTimeout(entry.timer);
    entry.status.nextRunAt = new Date(this.now() + delayMs).toISOString();
    entry.timer = setTimeout(() => {
      this.runNow(entry.def.name, { scheduled: true }).catch(() => {});
    }, delayMs);
    entry.timer.unref?.();
  }

  /** Runs a worker once unless it is disabled or already running. Never rejects. */
  async runNow(name, { scheduled = false } = {}) {
    const entry = this.workers.get(name);
    if (!entry) return { status: "unknown" };
    const { def, status } = entry;
    status.enabled = this.#isEnabled(entry);

    if (this.stopping) return { status: "stopped" };
    if (!status.enabled) {
      if (scheduled) this.#schedule(entry, this.#interval(entry));
      return { status: "disabled" };
    }
    if (entry.inFlight) {
      this.logger.warn(name, "skipping run: previous run still in flight");
      return { status: "skipped_overlap" };
    }

    status.running = true;
    status.lastRunAt = new Date(this.now()).toISOString();
    status.runCount += 1;
    let outcome;
    entry.inFlight = (async () => {
      const started = this.now();
      try {
        // Yield so synchronous worker code never blocks the caller's tick.
        await Promise.resolve();
        const result = await def.run({
          log: (message, fields) => this.logger.info(name, message, fields),
          warn: (message, fields) => this.logger.warn(name, message, fields),
        });
        status.consecutiveFailures = 0;
        status.lastError = null;
        status.lastResult = result ?? null;
        if (result?.skipped) {
          this.logger.warn(name, "run skipped", { reason: result.reason });
          outcome = { status: "skipped", reason: result.reason };
        } else {
          status.lastSuccessAt = new Date(this.now()).toISOString();
          this.logger.info(name, "run succeeded", { durationMs: this.now() - started });
          outcome = { status: "success", result };
        }
      } catch (error) {
        status.consecutiveFailures += 1;
        status.lastError = { message: String(error?.message || error), at: new Date(this.now()).toISOString() };
        this.logger.error(name, "run failed", {
          error: status.lastError.message,
          consecutiveFailures: status.consecutiveFailures,
        });
        outcome = { status: "failed", error: status.lastError.message };
      } finally {
        status.running = false;
        entry.inFlight = null;
        const delay =
          status.consecutiveFailures > 0
            ? Math.min(
                computeBackoff(status.consecutiveFailures, {
                  baseMs: def.backoffBaseMs ?? 5000,
                  maxMs: def.backoffMaxMs ?? 600000,
                  random: this.random,
                }),
                this.#interval(entry) * 10,
              )
            : this.#interval(entry);
        if (scheduled || this.started) {
          this.#schedule(entry, Math.max(delay, status.consecutiveFailures > 0 ? 1000 : 0));
        }
      }
    })();
    await entry.inFlight;
    return outcome;
  }

  getStatus() {
    return [...this.workers.values()].map(({ status, def }) => ({
      ...status,
      enabled: this.#isEnabled({ def }),
    }));
  }

  /** Clears timers and waits (up to timeoutMs) for in-flight runs. */
  async stop({ timeoutMs = 10000 } = {}) {
    this.stopping = true;
    this.started = false;
    const pending = [];
    for (const entry of this.workers.values()) {
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.status.nextRunAt = null;
      if (entry.inFlight) pending.push(entry.inFlight);
    }
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    });
    await Promise.race([Promise.allSettled(pending), timeout]);
    clearTimeout(timer);
  }
}
