import test from "node:test";
import assert from "node:assert/strict";

import { Scheduler, computeBackoff } from "../src/workers/scheduler.js";
import { createLogger, redact } from "../src/workers/logger.js";
import { handleStatusRequest } from "../src/workers/index.js";

const silent = createLogger(() => {});

test("computeBackoff grows exponentially, is capped and jittered", () => {
  assert.equal(computeBackoff(1, { baseMs: 100, random: () => 1 }), 100);
  assert.equal(computeBackoff(3, { baseMs: 100, random: () => 1 }), 400);
  assert.equal(computeBackoff(20, { baseMs: 100, maxMs: 1000, random: () => 1 }), 1000);
  assert.equal(computeBackoff(3, { baseMs: 100, random: () => 0.5 }), 200);
});

test("overlap lock prevents concurrent runs of the same worker", async () => {
  const s = new Scheduler({ logger: silent });
  let release;
  let calls = 0;
  s.register({ name: "w", intervalMs: 60000, run: () => { calls += 1; return new Promise((r) => (release = r)); } });
  const first = s.runNow("w");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await s.runNow("w"), { status: "skipped_overlap" });
  release();
  assert.equal((await first).status, "success");
  assert.equal(calls, 1);
});

test("errors are isolated and recorded in status", async () => {
  const s = new Scheduler({ logger: silent });
  s.register({ name: "bad", intervalMs: 60000, run: async () => { throw new Error("boom"); } });
  s.register({ name: "good", intervalMs: 60000, run: async () => ({ ok: 1 }) });
  assert.equal((await s.runNow("bad")).status, "failed");
  assert.equal((await s.runNow("good")).status, "success");
  const [bad, good] = s.getStatus();
  assert.equal(bad.lastError.message, "boom");
  assert.equal(bad.consecutiveFailures, 1);
  assert.equal(bad.lastSuccessAt, null);
  assert.ok(good.lastSuccessAt);
});

test("skipped runs (missing secret) do not count as failure or success", async () => {
  const s = new Scheduler({ logger: silent });
  s.register({ name: "w", intervalMs: 60000, run: async () => ({ skipped: true, reason: "missing secret" }) });
  assert.equal((await s.runNow("w")).status, "skipped");
  assert.equal(s.getStatus()[0].consecutiveFailures, 0);
  assert.equal(s.getStatus()[0].lastSuccessAt, null);
});

test("disabled workers do not run; flag is evaluated at run time", async () => {
  const s = new Scheduler({ logger: silent });
  let enabled = false;
  let calls = 0;
  s.register({ name: "w", intervalMs: 60000, enabled: () => enabled, run: async () => { calls += 1; } });
  assert.equal((await s.runNow("w")).status, "disabled");
  enabled = true;
  assert.equal((await s.runNow("w")).status, "success");
  assert.equal(calls, 1);
});

test("scheduler runs on a timer, exposes nextRunAt and stop() awaits in-flight jobs", async () => {
  const s = new Scheduler({ logger: silent });
  let finished = false;
  s.register({
    name: "w",
    intervalMs: 60000,
    initialDelayMs: 5,
    run: () => new Promise((r) => setTimeout(() => { finished = true; r(); }, 30)),
  });
  s.start();
  assert.ok(s.getStatus()[0].nextRunAt);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(s.getStatus()[0].running, true);
  await s.stop();
  assert.equal(finished, true);
  assert.equal(s.getStatus()[0].nextRunAt, null);
});

test("logger redacts secret env values", () => {
  process.env.SELLVIA_API_KEY = "super-secret-value";
  try {
    assert.equal(redact("key=super-secret-value"), "key=[REDACTED]");
  } finally {
    delete process.env.SELLVIA_API_KEY;
  }
});

test("status endpoints respond with worker state", () => {
  const s = new Scheduler({ logger: silent });
  s.register({ name: "w", intervalMs: 60000, run: async () => {} });
  let body;
  const res = { setHeader() {}, end: (b) => (body = JSON.parse(b)) };
  assert.equal(handleStatusRequest({ method: "GET", url: "/workers/status" }, res, s), true);
  assert.equal(body.workers[0].name, "w");
  assert.equal(handleStatusRequest({ method: "GET", url: "/other" }, res, s), false);
});
