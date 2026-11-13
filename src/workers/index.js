/**
 * Central registry: startWorkers() builds the scheduler, registers all workers,
 * installs process safeguards and graceful shutdown. Does nothing unless
 * WORKERS_ENABLED=true, so existing behaviour is unchanged by default.
 */
import http from "node:http";
import { Scheduler } from "./scheduler.js";
import { allWorkers } from "./workers.js";
import { createLogger } from "./logger.js";
import { workersEnabled } from "./env.js";

let scheduler = null;

export function getScheduler() {
  return scheduler;
}

export function statusPayload(sched = scheduler) {
  const workers = sched ? sched.getStatus() : [];
  const unhealthy = workers.filter((w) => w.enabled && w.consecutiveFailures > 0);
  return {
    ok: unhealthy.length === 0,
    workersEnabled: workersEnabled(),
    time: new Date().toISOString(),
    workers,
  };
}

/** Handles GET /health and /workers/status; returns false if the path isn't ours. */
export function handleStatusRequest(req, res, sched = scheduler) {
  const path = (req.url || "").split("?")[0];
  if (req.method !== "GET" || (path !== "/health" && path !== "/workers/status")) return false;
  const payload = statusPayload(sched);
  const body = path === "/health" ? { ok: payload.ok, workersEnabled: payload.workersEnabled, time: payload.time } : payload;
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
  return true;
}

export function startWorkers({ logger = createLogger(), installProcessHandlers = true } = {}) {
  if (!workersEnabled()) {
    logger.info("scheduler", "workers disabled (set WORKERS_ENABLED=true to enable)");
    return null;
  }
  if (scheduler) return scheduler;
  scheduler = new Scheduler({ logger });
  for (const def of allWorkers()) scheduler.register(def);
  scheduler.start();
  logger.info("scheduler", "workers started", { workers: allWorkers().map((w) => w.name) });

  if (installProcessHandlers) {
    const shutdown = async (signal) => {
      logger.info("scheduler", "shutting down", { signal });
      await scheduler.stop();
      process.exit(0);
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
    // Log only: the default crash behaviour is kept for real failures.
    process.on("unhandledRejection", (reason) => {
      logger.error("process", "unhandledRejection", { error: String(reason?.message || reason) });
    });
    process.on("uncaughtException", (error) => {
      logger.error("process", "uncaughtException", { error: String(error?.message || error) });
      scheduler.stop({ timeoutMs: 2000 }).finally(() => process.exit(1));
    });
  }
  return scheduler;
}

/** Standalone entry: `npm run workers` starts schedulers and a status server. */
export function startStandalone() {
  const sched = startWorkers();
  const server = http.createServer((req, res) => {
    if (!handleStatusRequest(req, res, sched)) {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(Number(process.env.PORT) || 3000);
  return server;
}
