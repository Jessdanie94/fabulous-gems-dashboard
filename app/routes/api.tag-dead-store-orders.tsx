import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  getAdminToken,
  getShopifyApiVersion,
  getStoreDomain,
  mergeTags,
  verifyShopifyWebhook,
} from "../lib/integrations.server";

// FLOW_3: Tag orders from deactivated stores (Shopify webhook: orders/create)
const DEAD_STORE_IDS = ["5809673777", "574805867"];

export async function action({ request }: ActionFunctionArgs) {
  const verified = await verifyShopifyWebhook(request);
  if (!verified.ok) return verified.response;
  const order = verified.payload;

  try {
    const shopifyToken = getAdminToken();
    const storeDomain = getStoreDomain();
    if (!shopifyToken || !storeDomain) {
      return json({ error: "Missing SHOPIFY_STORE_URL / SHOPIFY_ADMIN_ACCESS_TOKEN" }, { status: 503 });
    }

    const sourceStore = String(order?.source_identifier ?? order?.source_name ?? "");
    const isDead = DEAD_STORE_IDS.some((id) => sourceStore.includes(id));
    if (!isDead) return json({ tagged: false, reason: "Not from a dead store" });

    const res = await fetch(
      `https://${storeDomain}/admin/api/${getShopifyApiVersion()}/orders/${order.id}.json`,
      {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          order: { id: order.id, tags: mergeTags(order.tags, "dead-store-duplicate", "review-needed") },
        }),
      },
    );
    if (!res.ok) throw new Error(`Shopify tag update failed: HTTP ${res.status}`);

    return json({ tagged: true, orderId: order.id, sourceStore });
  } catch (err: any) {
    return json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
