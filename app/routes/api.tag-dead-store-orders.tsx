import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

const DEAD_STORE_IDS = ["5809673777", "574805867"];

export async function action({ request }: ActionFunctionArgs) {
  try {
    const order = await request.json();
    const shopifyToken = process.env.SHOPIFY_STORE1_TOKEN;
    const storeDomain = process.env.SHOPIFY_STORE1_DOMAIN;

    const sourceStore = String(order?.source_identifier ?? order?.source_name ?? "");
    const isDead = DEAD_STORE_IDS.some((id) => sourceStore.includes(id));

    if (!isDead) return json({ tagged: false, reason: "Not from a dead store" });

    await fetch(`https://${storeDomain}/admin/api/2024-01/orders/${order.id}.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": shopifyToken!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order: { id: order.id, tags: "dead-store-duplicate,review-needed" },
      }),
    });

    return json({ tagged: true, orderId: order.id, sourceStore });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
}
