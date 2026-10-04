/**
 * Shared helpers for Shopify webhook routes.
 *
 * - Resolves env vars across the naming schemes used in this repo
 *   (SHOPIFY_STORE_URL / SHOPIFY_STORE_DOMAIN / SHOPIFY_STORE1_DOMAIN, etc.)
 * - Verifies Shopify webhook HMAC signatures (fail closed)
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
  const raw = first("SHOPIFY_STORE_DOMAIN", "SHOPIFY_STORE_URL", "SHOPIFY_STORE1_DOMAIN");
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

export function getShopifyApiVersion(): string {
  return first("SHOPIFY_API_VERSION") || "2026-07";
}

/**
 * Reads the raw body and verifies X-Shopify-Hmac-Sha256.
 * Returns the parsed JSON payload, or a Response to return immediately.
 */
export async function verifyShopifyWebhook(
  request: Request,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; response: Response }> {
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
    const payload: unknown = JSON.parse(rawBody);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, response: json({ error: "Invalid order payload" }, { status: 400 }) };
    }
    return { ok: true, payload: payload as Record<string, unknown> };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}

/** Appends tags to an order without wiping the tags it already has. */
export function mergeTags(existing: unknown, ...add: string[]): string {
  const current = String(existing ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return Array.from(new Set([...current, ...add])).join(", " );
}
