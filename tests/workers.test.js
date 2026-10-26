import test from "node:test";
import assert from "node:assert/strict";

import { createLogger, redact } from "../src/workers/logger.js";
import { Scheduler, computeBackoffDelay } from "../src/workers/scheduler.js";
import { loadWorkerConfig, resolveRssUrl } from "../src/workers/config.js";
import { createAlerter } from "../src/workers/alerting.js";
import { WEBHOOK_STATUS, stateAfterFailure, stateAfterSuccess, webhookBackoffMs } from "../src/workers/webhook-state.js";
import { createWebhookRetryTask } from "../src/workers/tasks/webhook-retry.js";
import { createSyncTask, resolveWorkerSyncOptions } from "../src/workers/tasks/catalog-sync.js";
import { createTokenHealthTask } from "../src/workers/tasks/token-health.js";
import { validateFeed } from "../src/workers/tasks/store-drift.js";

const silentLogger = () => {
  const lines = [];
  const logger = createLogger({ write: (line) => lines.push(JSON.parse(line)), env: {} });
  return { logger, lines };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

test("scheduler never overlaps runs of the same task", async () => {
  const { logger, lines } = silentLogger();
  const scheduler = new Scheduler({ logger });
  const gate = deferred();
  let calls = 0;
  scheduler.register({ name: "slow", intervalMs: 1000, run: async () => { calls += 1; await gate.promise; } });

  const first = scheduler.runOnce("slow");
  await sleep(5);
  assert.deepEqual(await scheduler.runOnce("slow"), { outcome: "skipped" });
  assert.equal(calls, 1);
  assert.ok(lines.some((line) => line.msg === "task_skipped_overlap"));
  gate.resolve();
  assert.equal((await first).outcome, "success");
});

test("backoff grows after failures, is capped, and resets on success", async () => {
  assert.equal(computeBackoffDelay(100, 0, 1000), 100);
  assert.equal(computeBackoffDelay(100, 1, 1000), 200);
  assert.equal(computeBackoffDelay(100, 3, 1000), 800);
  assert.equal(computeBackoffDelay(100, 10, 1000), 1000);

  const { logger, lines } = silentLogger();
  const scheduler = new Scheduler({ logger });
  let fail = true;
  scheduler.register({ name: "flaky", intervalMs: 100, maxBackoffMs: 1000, run: async () => { if (fail) throw new Error("boom"); } });
  await scheduler.runOnce("flaky");
  await scheduler.runOnce("flaky");
  const failures = lines.filter((line) => line.msg === "task_failed");
  assert.equal(failures[1].consecutiveFailures, 2);
  assert.equal(failures[1].nextDelayMs, 400);
  fail = false;
  await scheduler.runOnce("flaky");
  fail = true;
  await scheduler.runOnce("flaky");
  assert.equal(lines.filter((line) => line.msg === "task_failed").at(-1).consecutiveFailures, 1);
});

test("a throwing task does not stop other tasks and triggers onFailure", async () => {
  const { logger } = silentLogger();
  const failed = [];
  const scheduler = new Scheduler({ logger, random: () => 0, onFailure: (task) => failed.push(task.name) });
  let goodRuns = 0;
  scheduler.register({ name: "bad", intervalMs: 5, run: async () => { throw new Error("nope"); } });
  scheduler.register({ name: "good", intervalMs: 5, run: async () => { goodRuns += 1; } });
  scheduler.start();
  await sleep(60);
  await scheduler.stop({ timeoutMs: 500 });
  assert.ok(goodRuns >= 2);
  assert.ok(failed.includes("bad"));
});

test("task timeout aborts the signal and records a failure", async () => {
  const { logger } = silentLogger();
  const scheduler = new Scheduler({ logger });
  let aborted = false;
  scheduler.register({
    name: "hang",
    intervalMs: 100,
    timeoutMs: 10,
    run: ({ signal }) => new Promise((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); })),
  });
  const result = await scheduler.runOnce("hang");
  assert.equal(result.outcome, "failure");
  assert.equal(result.error.code, "TASK_TIMEOUT");
  assert.ok(aborted);
});

test("graceful shutdown stops scheduling and waits for in-flight tasks", async () => {
  const { logger } = silentLogger();
  const scheduler = new Scheduler({ logger, random: () => 0 });
  const gate = deferred();
  let finished = false;
  let runs = 0;
  scheduler.register({ name: "inflight", intervalMs: 5, run: async () => { runs += 1; await gate.promise; finished = true; } });
  scheduler.start();
  await sleep(20);
  const stopping = scheduler.stop({ timeoutMs: 1000 });
  setTimeout(gate.resolve, 20);
  assert.deepEqual(await stopping, { timedOut: false });
  assert.ok(finished);
  await sleep(30);
  assert.equal(runs, 1);
});

test("shutdown gives up after the timeout", async () => {
  const { logger } = silentLogger();
  const scheduler = new Scheduler({ logger, random: () => 0 });
  scheduler.register({ name: "stuck", intervalMs: 5, run: () => new Promise(() => {}) });
  scheduler.start();
  await sleep(20);
  assert.deepEqual(await scheduler.stop({ timeoutMs: 20 }), { timedOut: true });
});

test("redact removes secrets by key, pattern and known env value", () => {
  const env = { SHOPIFY_API_TOKEN: "super-secret-token-value" };
  const out = redact(
    {
      headers: { Authorization: "******", "X-Shopify-Access-Token": "shpat_123456" },
      note: "token super-secret-token-value used with ****** and shpat_abcdef",
      nested: { apiKey: "k", ok: "visible" },
      error: new Error("failed with super-secret-token-value"),
    },
    env,
  );
  const text = JSON.stringify(out);
  for (const leaked of ["abc.def", "shpat_", "super-secret-token-value", "xyz123"]) {
    assert.ok(!text.includes(leaked), `leaked ${leaked}`);
  }
  assert.equal(out.nested.ok, "visible");
});

test("logger emits redacted structured JSON", () => {
  const lines = [];
  const logger = createLogger({ write: (l) => lines.push(l), env: { SELLVIA_API_KEY: "sellvia-key-123456" } });
  logger.info("hello", { task: "t", message: "key sellvia-key-123456", authorization: "******" });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.task, "t");
  assert.ok(!lines[0].includes("sellvia-key-123456"));
});

test("workers are disabled by default and domain defaults are flagship-based", () => {
  assert.equal(loadWorkerConfig({}).enabled, false);
  assert.equal(loadWorkerConfig({ BACKGROUND_WORKERS_ENABLED: "true" }).enabled, true);
  assert.equal(resolveRssUrl({}), "https://fabulousgemsparlor.store/collections/all.atom");
  assert.equal(resolveRssUrl({ STORE_DOMAIN: "example.com" }), "https://example.com/collections/all.atom");
});

test("webhook state transitions: retry, backoff, dead, success", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const opts = { now, maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000, error: new Error("bad") };
  assert.equal(webhookBackoffMs(1, 1000, 5000), 1000);
  assert.equal(webhookBackoffMs(4, 1000, 5000), 5000);

  const second = stateAfterFailure({ attempts: 1 }, opts);
  assert.equal(second.status, WEBHOOK_STATUS.FAILED);
  assert.equal(second.attempts, 2);
  assert.equal(second.nextAttemptAt.getTime(), now.getTime() + 2000);

  const dead = stateAfterFailure({ attempts: 2 }, opts);
  assert.equal(dead.status, WEBHOOK_STATUS.DEAD);
  assert.equal(dead.nextAttemptAt, null);

  const ok = stateAfterSuccess({ attempts: 1 }, { now });
  assert.equal(ok.status, WEBHOOK_STATUS.PROCESSED);
  assert.equal(ok.lastError, null);
});

function fakePrisma(events) {
  return {
    webhookEvent: {
      findMany: async () => events.filter((e) => e.status === "failed"),
      updateMany: async ({ where, data }) => {
        const event = events.find((e) => e.id === where.id);
        Object.assign(event, data);
        return { count: 1 };
      },
      update: async ({ where, data }) => Object.assign(events.find((e) => e.id === where.id), data),
    },
  };
}

test("webhook-retry task processes, retries and dead-letters events", async () => {
  const events = [
    { id: "a", webhookId: "wa", topic: "APP_UNINSTALLED", shop: "s", payload: "{}", status: "failed", attempts: 1 },
    { id: "b", webhookId: "wb", topic: "APP_UNINSTALLED", shop: "s", payload: "{}", status: "failed", attempts: 1 },
    { id: "c", webhookId: "wc", topic: "APP_UNINSTALLED", shop: "s", payload: "{}", status: "failed", attempts: 7 },
  ];
  const config = loadWorkerConfig({ WEBHOOK_MAX_ATTEMPTS: "8" });
  const alerts = [];
  const task = createWebhookRetryTask({
    config,
    prisma: fakePrisma(events),
    handler: async (_p, event) => { if (event.id !== "a") throw new Error("still failing"); },
  });
  const { logger } = silentLogger();
  const stats = await task.run({ signal: new AbortController().signal, logger, alert: async (k) => alerts.push(k) });
  assert.deepEqual(stats, { due: 3, processed: 1, retried: 1, dead: 1, skipped: 0 });
  assert.equal(events[0].status, "processed");
  assert.equal(events[1].status, "failed");
  assert.equal(events[1].attempts, 2);
  assert.equal(events[2].status, "dead");
  assert.deepEqual(alerts, ["dead:c"]);
});

test("sync task defaults to dry-run and honors double opt-in for writes", async () => {
  const config = loadWorkerConfig({});
  assert.equal(resolveWorkerSyncOptions(config, {}).dryRun, true);
  assert.equal(resolveWorkerSyncOptions(config, { SYNC_DRY_RUN: "false" }).dryRun, true);
  const writable = loadWorkerConfig({ WORKER_SYNC_DRY_RUN: "false" });
  assert.equal(resolveWorkerSyncOptions(writable, {}).dryRun, true);
  assert.equal(resolveWorkerSyncOptions(writable, { SYNC_DRY_RUN: "false" }).dryRun, false);

  let received;
  const task = createSyncTask({
    config: loadWorkerConfig({ WORKER_SYNC_ENABLED: "true" }),
    env: {},
    sync: async (options) => { received = options; return { summary: { dryRun: true, scopes: [], created: 0, updated: 0, skipped: 0, failed: 0 } }; },
  });
  await task.run();
  assert.equal(received.dryRun, true);
  assert.equal(loadWorkerConfig({}).sync.enabled, false);
});

test("token health reports 401/403 and never leaks the token", async () => {
  const env = { SHOPIFY_STORE_DOMAIN: "x.myshopify.com", SHOPIFY_API_TOKEN: "shpat_secretvalue", SELLVIA_API_KEY: "sellvia-secret-key" };
  const seen = [];
  const request = async (url, init) => {
    seen.push(init.headers);
    return { response: { ok: url.includes("sellvia"), status: url.includes("sellvia") ? 200 : 401 } };
  };
  const { logger, lines } = silentLogger();
  const task = createTokenHealthTask({ config: loadWorkerConfig({}), prisma: null, env, request });
  await assert.rejects(task.run({ signal: new AbortController().signal, logger }), (error) => {
    assert.match(error.message, /shopify:unauthorized\(401\)/);
    assert.ok(!error.message.includes("shpat_secretvalue"));
    return true;
  });
  assert.equal(seen.length, 2);
  assert.ok(!JSON.stringify(lines).includes("shpat_secretvalue"));

  const ok = createTokenHealthTask({ config: loadWorkerConfig({}), prisma: null, env, request: async () => ({ response: { ok: true, status: 200 } }) });
  assert.equal((await ok.run({ signal: new AbortController().signal, logger })).checks.length, 2);
});

test("alerter de-duplicates within the cooldown window", async () => {
  const { logger } = silentLogger();
  let time = 0;
  let posts = 0;
  const alert = createAlerter({
    logger,
    env: { SYNC_FAILURE_WEBHOOK_URL: "https://hooks.example.com/secret-path" },
    cooldownMs: 1000,
    now: () => time,
    request: async (_url, init) => {
      posts += 1;
      assert.ok(!init.body.includes("secret-path"));
      return { response: { ok: true, status: 200 } };
    },
  });
  assert.equal((await alert("k", "m")).sent, true);
  assert.equal((await alert("k", "m")).reason, "deduplicated");
  time = 1500;
  assert.equal((await alert("k", "m")).sent, true);
  assert.equal(posts, 2);
});

test("feed validation requires parseable feed and flagship-domain links", () => {
  const good = '<feed xmlns="http://www.w3.org/2005/Atom"><link href="https://fabulousgemsparlor.store/collections/all.atom"/><entry><link href="https://fabulousgemsparlor.store/products/a"/></entry></feed>';
  assert.deepEqual(validateFeed(good, "fabulousgemsparlor.store"), []);
  assert.deepEqual(validateFeed("<html>nope</html>", "fabulousgemsparlor.store"), ["feed_not_parseable"]);
  assert.deepEqual(validateFeed(good.replace("/products/a", "/p").replace("https://fabulousgemsparlor.store/p", "https://wonderfulgemspoint.shop/p"), "fabulousgemsparlor.store"), ["feed_link_off_domain:wonderfulgemspoint.shop"]);
});
