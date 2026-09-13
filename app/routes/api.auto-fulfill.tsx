import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const order = await request.json();
    const shopifyToken = process.env.SHOPIFY_STORE1_TOKEN;
    const sellviaKey = process.env.SELLVIA_MASTER_KEY;
    const storeDomain = process.env.SHOPIFY_STORE1_DOMAIN;

    if (!order?.id) return json({ error: "No order ID" }, { status: 400 });

    const fulfillRes = await fetch("https://api.sellvia.com/api/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sellviaKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shopify_order_id: order.id,
        store_domain: storeDomain,
      }),
    });

    if (!fulfillRes.ok) {
      const err = await fulfillRes.text();
      throw new Error(`Sellvia fulfillment error: ${fulfillRes.status} — ${err}`);
    }

    const result = await fulfillRes.json();

    await fetch(`https://${storeDomain}/admin/api/2024-01/orders/${order.id}.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": shopifyToken!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order: { id: order.id, tags: "sellvia-auto-fulfilled" } }),
    });

    return json({ fulfilled: true, sellviaOrderId: result.id });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
}
