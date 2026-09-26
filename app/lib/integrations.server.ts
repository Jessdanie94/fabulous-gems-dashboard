/**
 * Shared helpers for the Shopify <-> Sellvia webhook/automation routes.
 *
 * - Resolves env vars across the naming schemes used in this repo
 *   (SHOPIFY_STORE_URL / SHOPIFY_STORE_DOMAIN / SHOPIFY_STORE1_DOMAIN, etc.)
 * - Verifies Shopify webhook HMAC signatures (fail closed)
 * - Builds a complete Sellvia order payload (shipping address + line items)
 */
import crypto from "node:crypto";
import { json } from "@remix-run/node";

const first = (...names: string[]): string | undefined => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value.trim();
  }
  return undefined;
};

export function getStoreDomain(): string | undefined {
  const raw = first("SHOPIFY_STORE_URL", "SHOPIFY_STORE_DOMAIN", "SHOPIFY_STORE1_DOMAIN");
  return raw?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function getAdminToken(): string | undefined {
  return first(
    "SHOPIFY_ADMIN_ACCESS_TOKEN",
    "SHOPIFY_ACCESS_TOKEN",
    "SHOPIFY_STORE1_TOKEN",
    "SHOPIFY_API_TOKEN",
  );
}

export function getSellviaKey(): string | undefined {
  return first("SELLVIA_API_KEY", "SELLVIA_MASTER_KEY");
}

export function getSellviaBaseUrl(): string {
  return (first("SELLVIA_API_BASE_URL") || "https://api.sellvia.com").replace(/\/+$/, "");
}

export function getShopifyApiVersion(): string {
  return first("SHOPIFY_API_VERSION") || "2026-07";
}

/**
 * Reads the raw body and verifies X-Shopify-Hmac-Sha256.
 * Returns the parsed JSON payload, or a Response to return immediately.
 */
export async function verifyShopifyWebhook(
  request: Request,
): Promise<{ ok: true; payload: any } | { ok: false; response: Response }> {
  const secret = first("SHOPIFY_WEBHOOK_SECRET", "SHOPIFY_API_SECRET");
  if (!secret) {
    return {
      ok: false,
      response: json(
        { error: "Webhook secret not configured (SHOPIFY_WEBHOOK_SECRET)" },
        { status: 503 },
      ),
    };
  }

  const rawBody = await request.text();
  const received = request.headers.get("x-shopify-hmac-sha256") || "";
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, response: json({ error: "Invalid webhook signature" }, { status: 401 }) };
  }

  try {
    return { ok: true, payload: JSON.parse(rawBody) };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}

/** Shared-secret check for internal cron-style endpoints (fail closed). */
export function verifyCronSecret(request: Request): Response | null {
  const secret = first("CRON_SECRET");
  if (!secret) {
    return json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const received = Buffer.from(request.headers.get("x-cron-secret") || "");
  const expected = Buffer.from(secret);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Appends tags to an order without wiping the tags it already has. */
export function mergeTags(existing: unknown, ...add: string[]): string {
  const current = String(existing ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set([...current, ...add])).join(", ");
}

const ADDRESS_FIELDS = [
  "first_name",
  "last_name",
  "name",
  "company",
  "address1",
  "address2",
  "city",
  "province",
  "province_code",
  "zip",
  "country",
  "country_code",
  "phone",
] as const;

function pickAddress(address: any) {
  if (!address) return null;
  const out: Record<string, unknown> = {};
  for (const field of ADDRESS_FIELDS) out[field] = address[field] ?? null;
  return out;
}

/** Fields Sellvia needs to ship the order; none of them are dropped. */
export function buildSellviaOrderPayload(order: any, storeDomain: string | undefined) {
  const shipping = order.shipping_address ?? order.billing_address ?? null;
  return {
    shopify_order_id: order.id,
    order_number: order.order_number ?? order.name ?? null,
    store_domain: storeDomain ?? null,
    store_id: process.env.SELLVIA_STORE_ID ?? null,
    email: order.email ?? order.contact_email ?? order.customer?.email ?? null,
    phone: order.phone ?? shipping?.phone ?? order.customer?.phone ?? null,
    customer: order.customer
      ? {
          id: order.customer.id ?? null,
          first_name: order.customer.first_name ?? null,
          last_name: order.customer.last_name ?? null,
          email: order.customer.email ?? null,
          phone: order.customer.phone ?? null,
        }
      : null,
    shipping_address: pickAddress(shipping),
    shipping_lines: (order.shipping_lines ?? []).map((l: any) => ({
      title: l.title ?? null,
      code: l.code ?? null,
      price: l.price ?? null,
    })),
    line_items: (order.line_items ?? []).map((li: any) => ({
      id: li.id,
      sku: li.sku ?? null,
      variant_id: li.variant_id ?? null,
      product_id: li.product_id ?? null,
      title: li.title ?? null,
      quantity: li.quantity,
      price: li.price ?? null,
      requires_shipping: li.requires_shipping ?? true,
    })),
    currency: order.currency ?? null,
    note: order.note ?? null,
  };
}

export const REQUIRED_SHIPPING_FIELDS = ["address1", "city", "zip", "country_code"] as const;

export function missingShippingFields(order: any): string[] {
  const shipping = order.shipping_address ?? null;
  if (!shipping) return ["shipping_address"];
  return REQUIRED_SHIPPING_FIELDS.filter((f) => !shipping[f] || String(shipping[f]).trim() === "");
}
