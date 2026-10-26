/**
 * Worker configuration, parsed from environment variables.
 *
 * Only scheduling/behaviour settings live here. Credentials (Shopify/Sellvia tokens, webhook URL)
 * are deliberately NOT captured: each task re-reads `process.env` on every run so secrets rotated
 * on Render are picked up without a restart.
 */

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const FLAGSHIP_STORE_DOMAIN = "fabulousgemsparlor.store";

export function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function envInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** Public flagship storefront domain (NOT the *.myshopify.com Admin API domain). */
export function resolveStoreDomain(env = process.env) {
  return (env.STORE_DOMAIN || FLAGSHIP_STORE_DOMAIN).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function resolveRssUrl(env = process.env) {
  return env.STORE_RSS_URL || `https://${resolveStoreDomain(env)}/collections/all.atom`;
}

function taskConfig(env, prefix, defaults) {
  return {
    enabled: envBool(env[`${prefix}_ENABLED`], defaults.enabled),
    intervalMs: envInt(env[`${prefix}_INTERVAL_MS`], defaults.intervalMs),
    timeoutMs: envInt(env[`${prefix}_TIMEOUT_MS`], defaults.timeoutMs),
  };
}

export function loadWorkerConfig(env = process.env) {
  return {
    enabled: envBool(env.BACKGROUND_WORKERS_ENABLED, false),
    shutdownTimeoutMs: envInt(env.WORKERS_SHUTDOWN_TIMEOUT_MS, 15000),
    initialJitterMs: envInt(env.WORKER_INITIAL_JITTER_MS, 30000),
    maxBackoffMs: envInt(env.WORKER_MAX_BACKOFF_MS, 6 * HOUR),
    alertCooldownMs: envInt(env.WORKER_ALERT_COOLDOWN_MS, HOUR),
    tokenHealth: {
      ...taskConfig(env, "WORKER_TOKEN_HEALTH", { enabled: true, intervalMs: 15 * MINUTE, timeoutMs: MINUTE }),
      sessionExpiryWarnMs: envInt(env.WORKER_SESSION_EXPIRY_WARN_MS, DAY),
    },
    // Off by default: the "Shopify + Sellvia Sync" GitHub Action already runs this every 30 minutes.
    sync: {
      ...taskConfig(env, "WORKER_SYNC", { enabled: false, intervalMs: HOUR, timeoutMs: 10 * MINUTE }),
      dryRun: envBool(env.WORKER_SYNC_DRY_RUN, true),
    },
    webhookRetry: {
      ...taskConfig(env, "WORKER_WEBHOOK_RETRY", { enabled: true, intervalMs: 2 * MINUTE, timeoutMs: 5 * MINUTE }),
      maxAttempts: envInt(env.WEBHOOK_MAX_ATTEMPTS, 8),
      baseDelayMs: envInt(env.WEBHOOK_RETRY_BASE_MS, MINUTE),
      maxDelayMs: envInt(env.WEBHOOK_RETRY_MAX_MS, HOUR),
      batchSize: envInt(env.WEBHOOK_RETRY_BATCH_SIZE, 25),
    },
    drift: {
      ...taskConfig(env, "WORKER_DRIFT", { enabled: true, intervalMs: 4 * HOUR, timeoutMs: 2 * MINUTE }),
      syncStaleAfterMs: envInt(env.SYNC_STALE_AFTER_MS, 3 * HOUR),
      feedCheckEnabled: envBool(env.WORKER_DRIFT_FEED_CHECK_ENABLED, true),
    },
    housekeeping: {
      ...taskConfig(env, "WORKER_HOUSEKEEPING", { enabled: true, intervalMs: DAY, timeoutMs: 5 * MINUTE }),
      artifactRetentionMs: envInt(env.RETENTION_ARTIFACTS_DAYS, 14) * DAY,
      webhookRetentionMs: envInt(env.RETENTION_WEBHOOK_DAYS, 30) * DAY,
    },
  };
}
