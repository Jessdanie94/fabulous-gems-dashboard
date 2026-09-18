import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildConfig,
  calculateTotals,
  matchRecords,
  redactRecord,
  requestWithRetry,
  runReconciliation,
} from "../src/reconcile-payouts.js";

function withEnv(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test("buildConfig does not require Sellvia credentials in shopify-only mode", async () => {
  await withEnv(
    {
      SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
      SHOPIFY_API_TOKEN: "token",
      SHOPIFY_ADMIN_ACCESS_TOKEN: undefined,
      RECON_SOURCE: "shopify-only",
      SELLVIA_RECONCILIATION_URL: undefined,
      SELLVIA_API_KEY: undefined,
      SELLVIA_MASTER_KEY: undefined,
    },
    async () => {
      const config = buildConfig();
      assert.equal(config.source, "shopify-only");
      assert.equal(config.shopify.accessToken, "token");
    },
  );
});

test("matchRecords follows exact, stable id, then amount/date policy", () => {
  const shopifyRecords = [
    {
      orderId: "1001",
      orderName: "#1001",
      providerReference: "txn-exact",
      amount: 20,
      currency: "USD",
      occurredAt: "2026-09-17T10:00:00.000Z",
    },
    {
      orderId: "1002",
      orderName: "#1002",
      providerReference: "txn-missing",
      amount: 45,
      currency: "USD",
      occurredAt: "2026-09-17T11:00:00.000Z",
    },
    {
      orderId: "1003",
      orderName: "#1003",
      providerReference: "txn-none",
      amount: 30,
      currency: "USD",
      occurredAt: "2026-09-17T12:00:00.000Z",
    },
  ];

  const sellviaRecords = [
    {
      orderId: "x-1",
      orderName: "A",
      providerReference: "txn-exact",
      amount: 20,
      currency: "USD",
      occurredAt: "2026-09-17T10:01:00.000Z",
    },
    {
      orderId: "1002",
      orderName: "different",
      providerReference: "other",
      amount: 45,
      currency: "USD",
      occurredAt: "2026-09-17T11:05:00.000Z",
    },
    {
      orderId: "x-3",
      orderName: "fallback",
      providerReference: "none",
      amount: 30,
      currency: "USD",
      occurredAt: "2026-09-17T12:30:00.000Z",
    },
  ];

  const result = matchRecords(shopifyRecords, sellviaRecords, 1);
  assert.equal(result.matches.length, 3);
  assert.deepEqual(
    result.matches.map((entry) => [entry.matchType, entry.reviewNeeded]),
    [
      ["exact_provider_reference", false],
      ["stable_order_identifier", true],
      ["amount_currency_date_window", true],
    ],
  );
  assert.equal(result.unmatchedShopify.length, 0);
  assert.equal(result.unmatchedSellvia.length, 0);
});

test("calculateTotals marks unavailable fields instead of fabricating", () => {
  const totals = calculateTotals({
    source: "shopify-sellvia",
    shopifyRecords: [
      { gross: 100, refunds: 5, fees: undefined, currency: "USD" },
      { gross: 50, refunds: 0, fees: 2, currency: "USD" },
    ],
    sellviaRecords: [{ amount: 140, currency: "USD" }],
    payouts: [{ amount: 138, currency: "USD" }],
    matches: [],
  });

  assert.equal(totals.grossSales.status, "available");
  assert.equal(totals.refunds.status, "available");
  assert.equal(totals.fees.status, "unavailable");
  assert.equal(totals.netPayout.status, "unavailable");
  assert.equal(totals.expectedAmount.status, "available");
  assert.equal(totals.actualPayout.status, "available");
  assert.equal(totals.variance.status, "available");
  assert.equal(totals.variance.value, -2);
});

test("redactRecord removes direct PII fields", () => {
  const redacted = redactRecord({
    orderId: "1001",
    email: "person@example.com",
    phone: "+1 555 555 5555",
    providerReference: "keep-ref",
    note: "Customer email person@example.com",
  });

  assert.equal("email" in redacted, false);
  assert.equal("phone" in redacted, false);
  assert.equal(redacted.providerReference, "keep-ref");
  assert.equal(redacted.note.includes("[REDACTED_EMAIL]"), true);
});

test("requestWithRetry retries on rate limits", async () => {
  const originalFetch = global.fetch;
  let attempts = 0;

  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const result = await requestWithRetry(
      "https://example.com/resource",
      {},
      { maxRetries: 2, timeoutMs: 1000, backoffMs: 0 },
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.attempts, 2);
    assert.equal(result.rateLimited, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("runReconciliation writes summary with review-needed and date window", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reconcile-"));
  const ordersFile = path.join(tempDir, "orders.json");
  const payoutsFile = path.join(tempDir, "payouts.json");
  const transactionsFile = path.join(tempDir, "transactions.json");
  const sellviaFile = path.join(tempDir, "sellvia.json");
  const artifactsDir = path.join(tempDir, "artifacts");

  await fs.writeFile(
    ordersFile,
    JSON.stringify([
      {
        id: 1001,
        name: "#1001",
        created_at: "2026-09-17T10:00:00Z",
        processed_at: "2026-09-17T10:00:00Z",
        currency: "USD",
        current_total_price: "20.00",
        total_price: "22.00",
        total_refunds: "0.00",
        financial_status: "paid",
      },
      {
        id: 1002,
        name: "#1002",
        created_at: "2026-09-17T11:00:00Z",
        processed_at: "2026-09-17T11:00:00Z",
        currency: "USD",
        current_total_price: "45.00",
        total_price: "45.00",
        total_refunds: "0.00",
        financial_status: "paid",
      },
      {
        id: 1003,
        name: "#1003",
        created_at: "2026-09-17T12:00:00Z",
        processed_at: "2026-09-17T12:00:00Z",
        currency: "USD",
        current_total_price: "30.00",
        total_price: "30.00",
        total_refunds: "0.00",
        financial_status: "paid",
      },
    ]),
  );

  await fs.writeFile(
    transactionsFile,
    JSON.stringify({
      "1001": [
        { id: 1, kind: "sale", status: "success", amount: "20.00", currency: "USD", authorization: "txn-exact", fee: "1.00" },
      ],
      "1002": [
        { id: 2, kind: "sale", status: "success", amount: "45.00", currency: "USD", authorization: "txn-2", fee: "1.50" },
      ],
      "1003": [
        { id: 3, kind: "sale", status: "success", amount: "30.00", currency: "USD", authorization: "txn-3", fee: "0.90" },
      ],
    }),
  );

  await fs.writeFile(
    payoutsFile,
    JSON.stringify([
      { id: "po_1", status: "PAID", amount: "95.00", currency: "USD", issuedAt: "2026-09-18T09:00:00Z" },
    ]),
  );

  await fs.writeFile(
    sellviaFile,
    JSON.stringify([
      {
        id: "sv-1",
        providerReference: "txn-exact",
        orderId: "1001",
        amount: "20.00",
        currency: "USD",
        processedAt: "2026-09-17T10:00:00Z",
      },
      {
        id: "sv-2",
        providerReference: "different",
        orderId: "1002",
        amount: "45.00",
        currency: "USD",
        processedAt: "2026-09-17T11:00:00Z",
      },
      {
        id: "sv-3",
        providerReference: "no-ref",
        orderId: "x-3",
        amount: "30.00",
        currency: "USD",
        processedAt: "2026-09-17T12:30:00Z",
      },
      {
        id: "sv-unmatched",
        providerReference: "none",
        orderId: "x-miss",
        amount: "11.00",
        currency: "USD",
        processedAt: "2026-09-17T12:30:00Z",
      },
    ]),
  );

  await withEnv(
    {
      SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
      SHOPIFY_API_TOKEN: "shopify-token",
      SHOPIFY_ADMIN_ACCESS_TOKEN: undefined,
      SHOPIFY_ORDERS_FILE: ordersFile,
      SHOPIFY_PAYOUTS_FILE: payoutsFile,
      SHOPIFY_TRANSACTIONS_FILE: transactionsFile,
      SELLVIA_RECONCILIATION_FILE: sellviaFile,
      SELLVIA_RECONCILIATION_URL: undefined,
      RECON_ARTIFACTS_DIR: artifactsDir,
    },
    async () => {
      const result = await runReconciliation({
        source: "shopify-sellvia",
        dryRun: "true",
        startDate: "2026-09-17",
        endDate: "2026-09-18",
        matchWindowDays: "1",
      });

      assert.equal(result.summary.dryRun, true);
      assert.equal(result.summary.dateWindow.startDate, "2026-09-17");
      assert.equal(result.summary.dateWindow.endDate, "2026-09-18");
      assert.equal(result.summary.matches.exact, 1);
      assert.equal(result.summary.matches.reviewNeeded, 2);
      assert.equal(result.summary.matches.unmatchedShopify, 0);
      assert.equal(result.summary.matches.unmatchedSellvia, 1);
      assert.equal(result.summary.totals.actualPayout.status, "available");
      assert.equal(result.summary.totals.expectedAmount.status, "available");

      const summaryArtifact = JSON.parse(
        await fs.readFile(path.join(artifactsDir, "summary.json"), "utf8"),
      );
      assert.equal(summaryArtifact.matches.reviewNeeded, 2);

      const csvArtifact = await fs.readFile(path.join(artifactsDir, "matches.csv"), "utf8");
      assert.equal(csvArtifact.includes("stable_order_identifier"), true);
      assert.equal(csvArtifact.includes("amount_currency_date_window"), true);

      const historyArtifact = JSON.parse(
        await fs.readFile(path.join(artifactsDir, "history.json"), "utf8"),
      );
      assert.equal(Array.isArray(historyArtifact), true);
      assert.equal(historyArtifact.length, 1);
    },
  );
});
