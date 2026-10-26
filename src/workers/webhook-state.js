/**
 * Pure state transitions for the webhook dead-letter queue.
 *
 * Status lifecycle:  failed --(retry ok)--> processed
 *                    failed --(retry fails, attempts < max)--> failed (nextAttemptAt = now + backoff)
 *                    failed --(retry fails, attempts >= max)--> dead (nextAttemptAt = null, alert)
 * `processing` is a transient claim marker set while a worker handles the event.
 */

export const WEBHOOK_STATUS = Object.freeze({
  FAILED: "failed",
  PROCESSING: "processing",
  PROCESSED: "processed",
  DEAD: "dead",
});

/** Exponential backoff: base * 2^(attempts-1), capped at maxMs. */
export function webhookBackoffMs(attempts, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, Math.min(attempts, 30) - 1));
}

function errorText(error) {
  return String(error?.message || error).slice(0, 1000);
}

/** State after a failed delivery/retry attempt. `event.attempts` is the number already made. */
export function stateAfterFailure(event, { now = new Date(), maxAttempts, baseDelayMs, maxDelayMs, error }) {
  const attempts = (event.attempts || 0) + 1;
  const lastError = errorText(error);
  if (attempts >= maxAttempts) {
    return { status: WEBHOOK_STATUS.DEAD, attempts, nextAttemptAt: null, lastError };
  }
  return {
    status: WEBHOOK_STATUS.FAILED,
    attempts,
    nextAttemptAt: new Date(now.getTime() + webhookBackoffMs(attempts, baseDelayMs, maxDelayMs)),
    lastError,
  };
}

export function stateAfterSuccess(event, { now = new Date() } = {}) {
  return { status: WEBHOOK_STATUS.PROCESSED, attempts: (event.attempts || 0) + 1, nextAttemptAt: null, lastError: null, processedAt: now };
}
