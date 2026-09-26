import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getSellviaBaseUrl, getSellviaKey, verifyShopifyWebhook } from "../lib/integrations.server";

// FLOW_4: Pause Sellvia campaigns when inventory <= 0 (Shopify webhook: inventory_levels/update)

export async function action({ request }: ActionFunctionArgs) {
  const verified = await verifyShopifyWebhook(request);
  if (!verified.ok) return verified.response;
  const payload = verified.payload;

  try {
    const sellviaKey = getSellviaKey();
    if (!sellviaKey) return json({ error: "Missing SELLVIA_API_KEY" }, { status: 503 });

    const available = payload?.available ?? payload?.inventory_item?.available ?? null;
    if (available === null) return json({ error: "No inventory data" }, { status: 400 });

    if (available > 0) return json({ paused: false, reason: "Stock available", available });

    const listRes = await fetch(`${getSellviaBaseUrl()}/api/v1/campaigns`, {
      headers: { Authorization: `Bearer ${sellviaKey}` },
    });
    if (!listRes.ok) throw new Error(`Sellvia API error: ${listRes.status}`);
    const { data: campaigns } = await listRes.json();

    const paused: string[] = [];
    for (const campaign of campaigns ?? []) {
      const res = await fetch(`${getSellviaBaseUrl()}/api/v1/campaigns/${campaign.id}/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sellviaKey}` },
      });
      if (res.ok) paused.push(campaign.name ?? campaign.id);
    }

    return json({ paused: true, campaignsPaused: paused, available });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
}
