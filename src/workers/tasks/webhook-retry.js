/**
 * TASK: Webhook retry / dead-letter processor
 *
 * Purpose:   Webhook deliveries that fail inside our handlers are stored in `WebhookEvent`
 *            (see app/routes/webhooks.*) instead of being dropped. This task retries them.
 * Schedule:  every WORKER_WEBHOOK_RETRY_INTERVAL_MS (default 2 min).
 * Flow:
 *   1. Select events with status=failed and nextAttemptAt <= now (plus `processing` claims older than
 *      10 min left by a crashed worker), oldest first, up to WEBHOOK_RETRY_BATCH_SIZE.
 *   2. Claim each via an optimistic updateMany (id + updatedAt) so concurrent workers can't double-run.
 *   3. Run the idempotent handler (src/workers/webhook-handlers.js).
 *      success -> processed; failure -> attempts+1 and nextAttemptAt = now + base*2^(attempts-1) (capped);
 *      attempts >= WEBHOOK_MAX_ATTEMPTS -> `dead` and an alert is sent.
 * Dedupe:    events are unique by X-Shopify-Webhook-Id; handlers are safe to re-run.
 * Failure:   per-event errors are captured in the row; the task itself only throws on DB errors.
 */
import { handleWebhookEvent } from "../webhook-handlers.js";
import { WEBHOOK_STATUS, stateAfterFailure, stateAfterSuccess } from "../webhook-state.js";

const STALE_CLAIM_MS = 600000;

export function createWebhookRetryTask({ config, prisma, handler = handleWebhookEvent, now = () => new Date() }) {
  const cfg = config.webhookRetry;
  return {
    name: "webhook-retry",
    intervalMs: cfg.intervalMs,
    timeoutMs: cfg.timeoutMs,
    enabled: cfg.enabled,
    async run({ signal, alert, logger }) {
      if (!prisma) throw new Error("Prisma client unavailable");
      const current = now();
      const due = await prisma.webhookEvent.findMany({
        where: {
          OR: [
            { status: WEBHOOK_STATUS.FAILED, nextAttemptAt: { lte: current } },
            { status: WEBHOOK_STATUS.PROCESSING, updatedAt: { lt: new Date(current.getTime() - STALE_CLAIM_MS) } },
          ],
        },
        orderBy: { nextAttemptAt: "asc" },
        take: cfg.batchSize,
      });

      const stats = { due: due.length, processed: 0, retried: 0, dead: 0, skipped: 0 };
      for (const event of due) {
        if (signal.aborted) break;
        const claim = await prisma.webhookEvent.updateMany({
          where: { id: event.id, updatedAt: event.updatedAt },
          data: { status: WEBHOOK_STATUS.PROCESSING },
        });
        if (claim.count !== 1) {
          stats.skipped += 1;
          continue;
        }
        try {
          await handler(prisma, event);
          await prisma.webhookEvent.update({ where: { id: event.id }, data: stateAfterSuccess(event, { now: now() }) });
          stats.processed += 1;
        } catch (error) {
          const next = stateAfterFailure(event, {
            now: now(),
            maxAttempts: cfg.maxAttempts,
            baseDelayMs: cfg.baseDelayMs,
            maxDelayMs: cfg.maxDelayMs,
            error,
          });
          await prisma.webhookEvent.update({ where: { id: event.id }, data: next });
          if (next.status === WEBHOOK_STATUS.DEAD) {
            stats.dead += 1;
            logger.error("webhook_dead", { id: event.id, topic: event.topic, shop: event.shop, attempts: next.attempts });
            await alert(`dead:${event.id}`, `Webhook ${event.topic} for ${event.shop} moved to dead-letter after ${next.attempts} attempts`, {
              webhookId: event.webhookId,
              lastError: next.lastError,
            });
          } else {
            stats.retried += 1;
          }
        }
      }
      return stats;
    },
  };
}
