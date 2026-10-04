import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  getAdminToken,
  getShopifyApiVersion,
  getStoreDomain,
  verifyShopifyWebhook,
} from "../lib/integrations.server";

// Shopify sends paid orders to the bridge; Sellvia's Shopify app owns fulfillment.
const QUEUED_TAG = "sellvia-queued";

export async function action({ request }: ActionFunctionArgs) {
  const verified = await verifyShopifyWebhook(request);
  if (!verified.ok) return verified.response;

  const order = verified.payload;
  const orderId = Number(order?.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return json({ error: "Invalid order ID" }, { status: 400 });
  }

  const storeDomain = getStoreDomain();
  const shopifyToken = getAdminToken();
  if (!storeDomain || !shopifyToken) {
    return json(
      { error: "Missing SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN" },
      { status: 503 },
    );
  }

  try {
    // tagsAdd preserves other tags and is safe when Shopify retries a webhook.
    const response = await fetch(
      `https://${storeDomain}/admin/api/${getShopifyApiVersion()}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": shopifyToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "mutation AddQueuedTag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }",
          variables: { id: `gid://shopify/Order/${orderId}`, tags: [QUEUED_TAG] },
        }),
      },
    );
    if (!response.ok) throw new Error(`Shopify tag update failed: HTTP ${response.status}`);

    const result: {
      errors?: { message: string }[];
      data?: { tagsAdd?: { userErrors?: { message: string }[] } };
    } = await response.json();
    const errors = [...(result.errors ?? []), ...(result.data?.tagsAdd?.userErrors ?? [])];
    if (errors.length || !result.data?.tagsAdd) {
      throw new Error(`Shopify tag update failed: ${errors.map((error) => error.message).join(", ") || "Missing tagsAdd result"}`);
    }

    console.info(`Order ${orderId} tagged ${QUEUED_TAG}; Sellvia app handles fulfillment`);
    return json({ queued: true, orderId });
  } catch (error) {
    console.error(`Failed to tag order ${orderId}:`, error);
    return json({ error: "Shopify tag update failed" }, { status: 502 });
  }
}
