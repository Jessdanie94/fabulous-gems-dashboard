/**
 * Background worker composition root.
 *
 * `createWorkers()` wires the scheduler, alerting and the five tasks. `startWorkers()` additionally
 * starts them and installs SIGTERM/SIGINT handlers for graceful shutdown. Nothing starts unless
 * BACKGROUND_WORKERS_ENABLED=true.
 *
 * Hosting: run as a separate process (`npm run workers`, e.g. a Render Background Worker) or,
 * optionally, inside the Express server (`server.js`) with WORKERS_IN_PROCESS=true.
 */
import { createAlerter } from "./alerting.js";
import { loadWorkerConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { Scheduler } from "./scheduler.js";
import { createSyncTask } from "./tasks/catalog-sync.js";
import { createDriftTask } from "./tasks/store-drift.js";
import { createHousekeepingTask } from "./tasks/housekeeping.js";
import { createTokenHealthTask } from "./tasks/token-health.js";
import { createWebhookRetryTask } from "./tasks/webhook-retry.js";

export function createWorkers({ env = process.env, prisma = null, logger = createLogger({ env }), request } = {}) {
  const config = loadWorkerConfig(env);
  const alert = createAlerter({ logger, env, cooldownMs: config.alertCooldownMs, ...(request ? { request } : {}) });
  const scheduler = new Scheduler({
    logger,
    alert,
    // Any task failure is forwarded to the (de-duplicated) alert webhook.
    onFailure: (task, error, failures) =>
      alert(`${task.name}:failure`, `Background task "${task.name}" failed (${failures} consecutive): ${error.message}`, { task: task.name, failures }),
  });

  const tasks = [
    createTokenHealthTask({ config, prisma, env, ...(request ? { request } : {}) }),
    createSyncTask({ config, env }),
    createWebhookRetryTask({ config, prisma }),
    createDriftTask({ config, env, ...(request ? { request } : {}) }),
    createHousekeepingTask({ config, prisma, env }),
  ];
  for (const task of tasks) {
    scheduler.register({ ...task, initialDelayMs: 0, jitterMs: config.initialJitterMs, maxBackoffMs: config.maxBackoffMs });
  }

  return { config, scheduler, logger };
}

/** Start workers if enabled. Returns `{ stop }` (or null when disabled). */
export function startWorkers({ env = process.env, prisma = null, logger, installSignalHandlers = true } = {}) {
  const config = loadWorkerConfig(env);
  const log = logger || createLogger({ env });
  if (!config.enabled) {
    log.info("workers_disabled", { hint: "set BACKGROUND_WORKERS_ENABLED=true to enable" });
    return null;
  }
  const workers = createWorkers({ env, prisma, logger: log });
  workers.scheduler.start();
  log.info("workers_started", { tasks: [...workers.scheduler.tasks.keys()] });

  let stopping = null;
  const stop = () => {
    stopping ||= workers.scheduler.stop({ timeoutMs: config.shutdownTimeoutMs });
    return stopping;
  };

  if (installSignalHandlers) {
    for (const signal of ["SIGTERM", "SIGINT"]) {
      process.once(signal, () => {
        log.info("shutdown_signal", { signal });
        stop().then(async () => {
          await prisma?.$disconnect?.();
          process.exit(0);
        });
      });
    }
  }
  return { stop, scheduler: workers.scheduler };
}
