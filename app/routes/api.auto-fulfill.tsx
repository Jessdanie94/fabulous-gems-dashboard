import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  buildSellviaOrderPayload,
  getAdminToken,
  getSellviaBaseUrl,
  getSellviaKey,
  getShopifyApiVersion,
  getStoreDomain,
  mergeTags,
  missingShippingFields,
  verifyShopifyWebhook,
} from "../lib/integrations.server";

// FLOW_2: Submit paid orders to Sellvia (Shopify webhook: orders/paid).
//
// IMPORTANT: this route does NOT create a Shopify fulfillment. Sellvia owns
// fulfillment status and pushes tracking back to Shopify itself. We only hand
// the order (with full shipping details) to Sellvia and tag it.
const SUBMITTED_TAG = "sellvia-auto-fulfilled";
const NEEDS_ADDRESS_TAG = "sellvia-missing-address";

export async function action({ request }: ActionFunctionArgs) {
  const verified = await verifyShopifyWebhook(request);
  if (!verified.ok) return verified.response;
  const order = verified.payload;

  const storeDomain = getStoreDomain();
  const shopifyToken = getAdminToken();
  const sellviaKey = getSellviaKey();

  if (!order?.id) return json({ error: "No order ID" }, { status: 400 });
  if (!storeDomain || !shopifyToken || !sellviaKey) {
    return json(
      { error: "Missing SHOPIFY_STORE_URL / SHOPIFY_ADMIN_ACCESS_TOKEN / SELLVIA_API_KEY" },
      { status: 503 },
    );
  }

  const shopifyOrderUrl = `https://${storeDomain}/admin/api/${getShopifyApiVersion()}/orders/${order.id}.json`;
  const tagOrder = (tags: string) =>
    fetch(shopifyOrderUrl, {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
      body: JSON.stringify({ order: { id: order.id, tags } }),
    });

  try {
    // Idempotency: Shopify retries webhooks; never submit the same order twice.
    if (String(order.tags ?? "").includes(SUBMITTED_TAG)) {
      return json({ skipped: true, reason: "Already submitted to Sellvia" });
    }

    // Don't send an order Sellvia can't ship; flag it for manual review instead.
    const missing = missingShippingFields(order);
    if (missing.length > 0) {
      await tagOrder(mergeTags(order.tags, NEEDS_ADDRESS_TAG, "review-needed"));
      // 200 so Shopify doesn't keep retrying a payload that will never be valid.
      return json({ submitted: false, reason: "Incomplete shipping address", missing });
    }

    const sellviaRes = await fetch(`${getSellviaBaseUrl()}/api/v1/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sellviaKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildSellviaOrderPayload(order, storeDomain)),
    });

    if (!sellviaRes.ok) {
      const err = await sellviaRes.text();
      throw new Error(`Sellvia order submit error: ${sellviaRes.status} ${err}`);
    }
    const result = await sellviaRes.json().catch(() => ({}));

    const tagRes = await tagOrder(mergeTags(order.tags, SUBMITTED_TAG));
    if (!tagRes.ok) {
      console.error(`Order ${order.id} sent to Sellvia but tagging failed: HTTP ${tagRes.status}`);
    }

    return json({ submitted: true, sellviaOrderId: result?.id ?? null });
  } catch (err: any) {
    console.error("auto-fulfill failed:", err?.message);
    return json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
