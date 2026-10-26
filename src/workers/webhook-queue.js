/**
 * Bounded in-memory dead-letter queue for failed outbound webhook deliveries.
 * (Process-local by design: no Redis/DB dependency.)
 */
const MAX_ITEMS = 500;
const queue = [];

export function enqueueFailedWebhook({ url, body, headers = {}, error }) {
  if (queue.length >= MAX_ITEMS) queue.shift();
  queue.push({ url, body, headers, attempts: 0, enqueuedAt: new Date().toISOString(), lastError: String(error || "") });
}

export function queueSize() {
  return queue.length;
}

/** Retries queued deliveries once each; drops items after maxAttempts (dead letter). */
export async function drainWebhookQueue({ maxAttempts, fetchImpl = fetch, timeoutMs = 10000 }) {
  const batch = queue.splice(0, queue.length);
  const stats = { delivered: 0, requeued: 0, dead: 0 };
  for (const item of batch) {
    item.attempts += 1;
    try {
      const res = await fetchImpl(item.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...item.headers },
        body: typeof item.body === "string" ? item.body : JSON.stringify(item.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      stats.delivered += 1;
    } catch (error) {
      item.lastError = String(error?.message || error);
      if (item.attempts >= maxAttempts) {
        stats.dead += 1;
      } else {
        queue.push(item);
        stats.requeued += 1;
      }
    }
  }
  return stats;
}
