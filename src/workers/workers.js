/**
 * Worker definitions. Each worker documents purpose, schedule and flow.
 *
 * Common env (read on every run): WORKER_<NAME>_ENABLED, WORKER_<NAME>_INTERVAL_MS.
 * Secrets are only ever read from env at run time; a missing secret => the run
 * is skipped with a warning (never a crash) and secret values are never logged.
 */
import { envFlag, envNumber, firstEnv } from "./env.js";
import { drainWebhookQueue, queueSize } from "./webhook-queue.js";

const MIN = 60 * 1000;

async function http(url, init = {}, timeoutMs = 15000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * TOKEN_REFRESH: credential validity check.
 * Schedule: every WORKER_TOKEN_REFRESH_INTERVAL_MS (default 30 min).
 * Flow: read Shopify + Sellvia credentials from env -> call Shopify shop.json and
 * the Sellvia base URL with them -> a 401/403 throws (visible in /workers/status,
 * retried with backoff). Because env is re-read every run, a rotated token is
 * picked up without restart. Failure: recorded, backoff, main process unaffected.
 */
export function tokenRefreshWorker() {
  return {
    name: "token-refresh",
    description: "Validates Shopify and Sellvia credentials; picks up rotated tokens",
    enabled: () => envFlag("WORKER_TOKEN_REFRESH_ENABLED", true),
    intervalMs: () => envNumber("WORKER_TOKEN_REFRESH_INTERVAL_MS", 30 * MIN),
    async run() {
      const domain = process.env.SHOPIFY_STORE_DOMAIN;
      const shopifyToken = firstEnv("SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_API_TOKEN");
      const sellviaKey = firstEnv("SELLVIA_API_KEY", "SELLVIA_MASTER_KEY");
      if (!domain || (!shopifyToken && !sellviaKey)) {
        return { skipped: true, reason: "missing SHOPIFY_STORE_DOMAIN and/or credentials" };
      }
      const result = {};
      if (shopifyToken) {
        const version = process.env.SHOPIFY_API_VERSION || "2025-01";
        const res = await http(`https://${domain}/admin/api/${version}/shop.json`, {
          headers: { "X-Shopify-Access-Token": shopifyToken },
        });
        if (res.status === 401 || res.status === 403) throw new Error(`Shopify credentials rejected (HTTP ${res.status})`);
        result.shopify = res.status;
      }
      if (sellviaKey) {
        const base = (process.env.SELLVIA_API_BASE_URL || "https://api.sellvia.com").replace(/\/$/, "");
        const res = await http(base, { headers: { Authorization: "Bearer " + sellviaKey } });
        if (res.status === 401 || res.status === 403) throw new Error(`Sellvia credentials rejected (HTTP ${res.status})`);
        result.sellvia = res.status;
      }
      return result;
    },
  };
}

/**
 * INVENTORY_SYNC: Shopify <-> Sellvia catalog/inventory/price sync.
 * Schedule: every WORKER_INVENTORY_SYNC_INTERVAL_MS (default 1 h); off by default.
 * Flow: dynamic-import src/shopify-sellvia-sync.js and call runSync(), which reads
 * all SYNC_* / credential env at run time. Writes stay governed by the existing
 * SYNC_DRY_RUN (default true) / SYNC_ENABLE_* flags, so this is safe by default.
 */
export function inventorySyncWorker() {
  return {
    name: "inventory-sync",
    description: "Runs the Shopify/Sellvia sync (honours SYNC_DRY_RUN and SYNC_ENABLE_* flags)",
    enabled: () => envFlag("WORKER_INVENTORY_SYNC_ENABLED", false),
    intervalMs: () => envNumber("WORKER_INVENTORY_SYNC_INTERVAL_MS", 60 * MIN),
    async run() {
      if (!process.env.SHOPIFY_STORE_DOMAIN || !firstEnv("SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_API_TOKEN") || !firstEnv("SELLVIA_API_KEY", "SELLVIA_MASTER_KEY")) {
        return { skipped: true, reason: "missing Shopify/Sellvia credentials" };
      }
      const { runSync } = await import("../shopify-sellvia-sync.js");
      const { summary } = await runSync();
      return summary;
    },
  };
}

/**
 * PAYOUT_REFRESH: refreshes payout data from Shopify Payments.
 * Schedule: every WORKER_PAYOUT_REFRESH_INTERVAL_MS (default 15 min).
 * Flow: GET shopify_payments/payouts.json (read-only) -> keep latest payout summary
 * in memory (exposed via /workers/status lastResult). Failure: backoff + retry.
 */
export function payoutRefreshWorker() {
  return {
    name: "payout-refresh",
    description: "Refreshes the latest Shopify Payments payouts (read-only)",
    enabled: () => envFlag("WORKER_PAYOUT_REFRESH_ENABLED", true),
    intervalMs: () => envNumber("WORKER_PAYOUT_REFRESH_INTERVAL_MS", 15 * MIN),
    async run() {
      const domain = process.env.SHOPIFY_STORE_DOMAIN;
      const token = firstEnv("SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_API_TOKEN");
      if (!domain || !token) return { skipped: true, reason: "missing Shopify credentials" };
      const version = process.env.SHOPIFY_API_VERSION || "2025-01";
      const res = await http(`https://${domain}/admin/api/${version}/shopify_payments/payouts.json?limit=10`, {
        headers: { "X-Shopify-Access-Token": token },
      });
      if (!res.ok) throw new Error(`Shopify payouts request failed (HTTP ${res.status})`);
      const data = await res.json();
      const payouts = Array.isArray(data.payouts) ? data.payouts : [];
      return { payouts: payouts.length, latest: payouts[0] ? { id: payouts[0].id, status: payouts[0].status, date: payouts[0].date } : null };
    },
  };
}

/**
 * WEBHOOK_RETRY: retries failed outbound webhook deliveries (dead-letter queue).
 * Schedule: every WORKER_WEBHOOK_RETRY_INTERVAL_MS (default 5 min).
 * Flow: drain in-memory queue (see webhook-queue.js), POST each item again; after
 * WORKER_WEBHOOK_MAX_ATTEMPTS (default 5) the item is dropped as dead.
 */
export function webhookRetryWorker() {
  return {
    name: "webhook-retry",
    description: "Retries failed webhook deliveries; dead-letters after max attempts",
    enabled: () => envFlag("WORKER_WEBHOOK_RETRY_ENABLED", true),
    intervalMs: () => envNumber("WORKER_WEBHOOK_RETRY_INTERVAL_MS", 5 * MIN),
    async run() {
      if (queueSize() === 0) return { delivered: 0, requeued: 0, dead: 0 };
      return drainWebhookQueue({ maxAttempts: envNumber("WORKER_WEBHOOK_MAX_ATTEMPTS", 5) });
    },
  };
}

/**
 * HEALTH_PING: keep-alive and liveness for the Render service and the bridge.
 * Schedule: every WORKER_HEALTH_PING_INTERVAL_MS (default 10 min).
 * Flow: GET RENDER_HEALTH_URL (or SHOPIFY_APP_URL/health) and BRIDGE_HEALTH_URL
 * (e.g. https://jesse-autopilot-bridge.onrender.com/health); non-2xx throws.
 * Result reports per-target liveness. Skipped when no URL is configured.
 */
export function healthPingWorker() {
  return {
    name: "health-ping",
    description: "Pings Render service and Jesse-Autopilot-Bridge to report integration liveness",
    enabled: () => envFlag("WORKER_HEALTH_PING_ENABLED", true),
    intervalMs: () => envNumber("WORKER_HEALTH_PING_INTERVAL_MS", 10 * MIN),
    async run() {
      const targets = {
        render: process.env.RENDER_HEALTH_URL || (process.env.SHOPIFY_APP_URL ? `${process.env.SHOPIFY_APP_URL.replace(/\/$/, "")}/health` : undefined),
        bridge: process.env.BRIDGE_HEALTH_URL,
      };
      const entries = Object.entries(targets).filter(([, url]) => url);
      if (entries.length === 0) return { skipped: true, reason: "no RENDER_HEALTH_URL / BRIDGE_HEALTH_URL configured" };
      const result = {};
      const failures = [];
      for (const [name, url] of entries) {
        try {
          const res = await http(url, { headers: process.env.BRIDGE_AUTH_TOKEN && name === "bridge" ? { Authorization: "Bearer " + process.env.BRIDGE_AUTH_TOKEN } : {} });
          result[name] = { live: res.ok, status: res.status };
          if (!res.ok) failures.push(`${name} HTTP ${res.status}`);
        } catch (error) {
          result[name] = { live: false, error: String(error?.message || error) };
          failures.push(`${name} ${result[name].error}`);
        }
      }
      if (failures.length) throw new Error(`Unhealthy: ${failures.join(", ")}`);
      return result;
    },
  };
}

export function allWorkers() {
  return [tokenRefreshWorker(), inventorySyncWorker(), payoutRefreshWorker(), webhookRetryWorker(), healthPingWorker()];
}
