/**
 * Alerting for background workers.
 *
 * Purpose: forward task failures / findings to the existing `SYNC_FAILURE_WEBHOOK_URL`.
 * Flow: `alert(key, message, details)` -> de-dupe by key within `cooldownMs` -> POST JSON via the
 *       sync engine's `requestWithRetry` (timeouts + backoff). The URL is re-read from the
 *       environment on each call and is never logged.
 * Failure behavior: alerting errors are logged (redacted) and swallowed; they never propagate.
 *
 * A persistent failure therefore produces at most one alert per key per cooldown window.
 */

import { requestWithRetry } from "./request.js";
import { redact } from "./logger.js";

export function createAlerter({
  logger,
  env = process.env,
  cooldownMs = 3600000,
  request = requestWithRetry,
  now = () => Date.now(),
}) {
  const lastSent = new Map();

  return async function alert(key, message, details = {}) {
    const url = env.SYNC_FAILURE_WEBHOOK_URL;
    const previous = lastSent.get(key);
    if (previous !== undefined && now() - previous < cooldownMs) {
      return { sent: false, reason: "deduplicated" };
    }
    lastSent.set(key, now());

    if (!url) {
      logger.warn("alert_not_sent", { key, reason: "SYNC_FAILURE_WEBHOOK_URL not configured", message });
      return { sent: false, reason: "no_webhook" };
    }

    try {
      const body = redact({ source: "fabulous-gems-workers", key, text: message, details, at: new Date(now()).toISOString() }, env);
      const { response } = await request(
        url,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        { timeoutMs: 10000, maxRetries: 2, backoffMs: 1000, idempotent: true },
      );
      if (!response.ok) throw new Error(`Alert webhook responded with HTTP ${response.status}`);
      return { sent: true };
    } catch (error) {
      logger.error("alert_failed", { key, error });
      return { sent: false, reason: "error" };
    }
  };
}
