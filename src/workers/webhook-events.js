/**
 * Persistence helpers for the webhook dead-letter table (`WebhookEvent`).
 * Used by the Remix webhook routes to avoid dropping failed deliveries.
 * Events are de-duplicated by Shopify's `X-Shopify-Webhook-Id` (unique `webhookId`).
 */
import { WEBHOOK_STATUS } from "./webhook-state.js";

const DEFAULT_FIRST_RETRY_MS = 60000;

function fallbackId(topic, shop, payload) {
  return `nohook:${topic}:${shop}:${JSON.stringify(payload ?? null).length}:${Date.now()}`;
}

/** Record a failed first delivery so the retry worker can pick it up. */
export async function recordWebhookFailure(prisma, { webhookId, topic, shop, payload, error, now = new Date() }) {
  const id = webhookId || fallbackId(topic, shop, payload);
  const lastError = String(error?.message || error).slice(0, 1000);
  const nextAttemptAt = new Date(now.getTime() + DEFAULT_FIRST_RETRY_MS);
  return prisma.webhookEvent.upsert({
    where: { webhookId: id },
    create: { webhookId: id, topic, shop, payload: JSON.stringify(payload ?? null), status: WEBHOOK_STATUS.FAILED, attempts: 1, nextAttemptAt, lastError },
    update: { lastError },
  });
}

/** If this delivery was previously stored as failed and now succeeded, close it out. */
export async function markWebhookProcessed(prisma, webhookId, now = new Date()) {
  if (!webhookId) return;
  await prisma.webhookEvent.updateMany({
    where: { webhookId, status: { in: [WEBHOOK_STATUS.FAILED, WEBHOOK_STATUS.PROCESSING] } },
    data: { status: WEBHOOK_STATUS.PROCESSED, nextAttemptAt: null, lastError: null, processedAt: now },
  });
}
