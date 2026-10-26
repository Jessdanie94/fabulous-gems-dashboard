import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleWebhookEvent } from "../../src/workers/webhook-handlers.js";
import { markWebhookProcessed, recordWebhookFailure } from "../../src/workers/webhook-events.js";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled;
  // the handler is idempotent (deleteMany) so repeats are harmless.
  try {
    await handleWebhookEvent(db, { topic, shop, payload });
    await markWebhookProcessed(db, webhookId);
  } catch (error) {
    // Persist for the webhook-retry worker instead of dropping; if this also fails, rethrow so Shopify retries.
    await recordWebhookFailure(db, { webhookId, topic, shop, payload, error });
  }

  return new Response();
};
