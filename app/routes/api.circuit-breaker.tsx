import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

async function getSellviaDailySpend(storeKey: string): Promise<number> {
  const apiKey = process.env.SELLVIA_MASTER_KEY;
  const res = await fetch("https://api.sellvia.com/api/v1/campaigns/spend/today", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Sellvia spend API error: ${res.status}`);
  const data = await res.json();
  return data.total_spend ?? data.spend ?? 0;
}

async function pauseAllProductCampaigns(storeKey: string): Promise<void> {
  const apiKey = process.env.SELLVIA_MASTER_KEY;
  const listRes = await fetch("https://api.sellvia.com/api/v1/campaigns", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!listRes.ok) throw new Error(`Sellvia campaigns API error: ${listRes.status}`);
  const { data: campaigns } = await listRes.json();
  for (const campaign of campaigns ?? []) {
    const name: string = campaign.name ?? campaign.title ?? "";
    if (name.toLowerCase().includes("all-product") || name.toLowerCase().includes("all product")) {
      await fetch(`https://api.sellvia.com/api/v1/campaigns/${campaign.id}/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    }
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { max } = await request.json();
    const spend = await getSellviaDailySpend("STORE1");
    if (spend > (max || 15)) {
      await pauseAllProductCampaigns("STORE1");
      return json({ paused: true, spend });
    }
    return json({ paused: false, spend });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
}
