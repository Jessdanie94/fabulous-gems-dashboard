import crypto from "node:crypto";
import type { ActionFunctionArgs } from "@remix-run/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../app/routes/api.auto-fulfill";

const secret = "webhook-test-secret";
const originalEnv = { ...process.env };

function signedRequest(body: string, signature?: string) {
  const hmac = signature ?? crypto.createHmac("sha256", secret).update(body).digest("base64");
  return new Request("https://bridge.example/api/auto-fulfill", {
    method: "POST",
    headers: { "X-Shopify-Hmac-Sha256": hmac, "Content-Type": "application/json" },
    body,
  });
}

function submit(request: Request) {
  return action({ request } as ActionFunctionArgs);
}

const success = { data: { tagsAdd: { userErrors: [] } } };

beforeEach(() => {
  process.env.SHOPIFY_WEBHOOK_SECRET = secret;
  process.env.SHOPIFY_STORE_DOMAIN = "store.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shopify-token";
  delete process.env.SHOPIFY_STORE_URL;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("paid order webhook", () => {
  it("verifies the webhook and adds only a queued tag via Shopify", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(success), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await submit(signedRequest(JSON.stringify({ id: 123, tags: "vip", shipping_address: null })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ queued: true, orderId: 123 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://store.myshopify.com/admin/api/2026-07/graphql.json");
    expect(options.method).toBe("POST");
    expect(options.headers["X-Shopify-Access-Token"]).toBe("shopify-token");
    expect(JSON.parse(options.body).variables).toEqual({ id: "gid://shopify/Order/123", tags: ["sellvia-queued"] });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Order 123 tagged sellvia-queued"));
  });

  it("rejects bad signatures without calling Shopify", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await submit(signedRequest('{"id":123}', "bad-signature"));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when the signing secret is not configured", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    delete process.env.SHOPIFY_API_SECRET;
    const response = await submit(signedRequest('{"id":123}'));
    expect(response.status).toBe(503);
  });

  it("rejects malformed JSON and missing or invalid order IDs", async () => {
    expect((await submit(signedRequest("{"))).status).toBe(400);
    expect((await submit(signedRequest("null"))).status).toBe(400);
    for (const id of [undefined, "1/not-a-number", -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect((await submit(signedRequest(JSON.stringify({ id })))).status).toBe(400);
    }
  });

  it("requires Shopify credentials", async () => {
    delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
    delete process.env.SHOPIFY_STORE1_TOKEN;
    delete process.env.SHOPIFY_API_TOKEN;
    expect((await submit(signedRequest('{"id":123}'))).status).toBe(503);
  });

  it("returns an error for HTTP failures and GraphQL userErrors so Shopify can retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("error", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { tagsAdd: { userErrors: [{ message: "Denied" }] } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "No access" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < 3; index++) {
      const response = await submit(signedRequest('{"id":123}'));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Shopify tag update failed" });
    }
  });

  it("repeated webhook deliveries use the same idempotent tagsAdd mutation", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(success), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < 2; index++) {
      expect((await submit(signedRequest('{"id":123}'))).status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].body).toEqual(fetchMock.mock.calls[1][1].body);
  });
});
