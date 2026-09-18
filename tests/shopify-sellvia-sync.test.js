import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildConfig,
  buildIdentityKey,
  planProductChanges,
  requestWithRetry,
  runSync,
} from "../src/shopify-sellvia-sync.js";

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

test("buildConfig accepts legacy secret names", async () => {
  await withEnv(
    {
      SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
      SHOPIFY_API_TOKEN: "shopify-token",
      SHOPIFY_ADMIN_ACCESS_TOKEN: undefined,
      SELLVIA_MASTER_KEY: "sellvia-token",
      SELLVIA_API_KEY: undefined,
      SYNC_DRY_RUN: "true",
      SYNC_SCOPE: "catalog",
      SELLVIA_PRODUCTS_FILE: "/tmp/products.json",
    },
    async () => {
      const config = buildConfig();
      assert.equal(config.shopify.accessToken, "shopify-token");
      assert.equal(config.sellvia.accessKey, "sellvia-token");
      assert.deepEqual(config.scopes, ["catalog"]);
      assert.equal(config.dryRun, true);
    },
  );
});

test("buildIdentityKey prefers external id then sku then handle", () => {
  assert.equal(buildIdentityKey({ externalId: "sv-1", sku: "SKU1", handle: "ring" }), "external:sv-1");
  assert.equal(buildIdentityKey({ sku: "SKU1", handle: "ring" }), "sku:sku1");
  assert.equal(buildIdentityKey({ handle: "ring" }), "handle:ring");
});

test("planProductChanges is idempotent for already-synced products", () => {
  const sellviaProducts = [
    {
      id: "sv-1",
      sku: "RING-1",
      title: "Gold Ring",
      handle: "gold-ring",
      price: "19.99",
      inventory: 5,
    },
  ];
  const shopifyProducts = [
    {
      id: 10,
      title: "Gold Ring",
      handle: "gold-ring",
      tags: "sellvia-id:sv-1",
      variants: [
        {
          id: 20,
          sku: "RING-1",
          price: "19.99",
          inventory_quantity: 5,
        },
      ],
    },
  ];

  const plan = planProductChanges(sellviaProducts, shopifyProducts);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, "skip");
  assert.deepEqual(plan[0].updates, []);
});

test("planProductChanges identifies creates and updates deterministically", () => {
  const sellviaProducts = [
    {
      id: "sv-1",
      sku: "RING-1",
      title: "Gold Ring Deluxe",
      handle: "gold-ring",
      price: "29.99",
      inventory: 8,
    },
    {
      id: "sv-2",
      sku: "RING-2",
      title: "Silver Ring",
      handle: "silver-ring",
      price: "14.99",
      inventory: 3,
    },
  ];
  const shopifyProducts = [
    {
      id: 10,
      title: "Gold Ring",
      handle: "gold-ring",
      tags: "sellvia-id:sv-1",
      variants: [
        {
          id: 20,
          sku: "RING-1",
          price: "19.99",
          inventory_quantity: 5,
        },
      ],
    },
  ];

  const plan = planProductChanges(sellviaProducts, shopifyProducts);
  assert.equal(plan[0].action, "update");
  assert.deepEqual(
    plan[0].updates.map((update) => update.field),
    ["title", "price", "inventory"],
  );
  assert.equal(plan[1].action, "create");
});

test("planProductChanges fails closed for invalid external data", () => {
  assert.throws(
    () => planProductChanges([{ title: "Broken", price: -1 }], []),
    /Invalid price value/,
  );
});

test("requestWithRetry retries on rate limits and tracks counts", async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const { response, attempts: usedAttempts, rateLimited } = await requestWithRetry(
      "https://example.com/products",
      {},
      { maxRetries: 2, backoffMs: 0, timeoutMs: 1000 },
    );
    assert.equal(response.status, 200);
    assert.equal(usedAttempts, 2);
    assert.equal(rateLimited, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("runSync produces dry-run summary and artifacts without writes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sellvia-sync-"));
  const sellviaProductsFile = path.join(tempDir, "sellvia-products.json");
  const sellviaInventoryFile = path.join(tempDir, "sellvia-inventory.json");
  const sellviaPricesFile = path.join(tempDir, "sellvia-prices.json");
  const shopifyProductsFile = path.join(tempDir, "shopify-products.json");
  const artifactsDir = path.join(tempDir, "artifacts");

  await fs.writeFile(
    sellviaProductsFile,
    JSON.stringify([
      { id: "sv-1", sku: "RING-1", title: "Gold Ring", handle: "gold-ring", price: "19.99", inventory: 5 },
      { id: "sv-2", sku: "RING-2", title: "Silver Ring", handle: "silver-ring", price: "14.99", inventory: 3 },
    ]),
  );
  await fs.writeFile(
    sellviaInventoryFile,
    JSON.stringify([{ id: "sv-1", sku: "RING-1", inventory: 9 }]),
  );
  await fs.writeFile(
    sellviaPricesFile,
    JSON.stringify([{ id: "sv-1", sku: "RING-1", price: "21.99" }]),
  );
  await fs.writeFile(
    shopifyProductsFile,
    JSON.stringify([
      {
        id: 10,
        title: "Gold Ring",
        handle: "gold-ring",
        tags: "sellvia-id:sv-1",
        variants: [{ id: 20, sku: "RING-1", price: "19.99", inventory_quantity: 5 }],
      },
    ]),
  );

  await withEnv(
    {
      SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
      SHOPIFY_API_TOKEN: "shopify-token",
      SELLVIA_MASTER_KEY: "sellvia-token",
      SHOPIFY_PRODUCTS_FILE: shopifyProductsFile,
      SELLVIA_PRODUCTS_FILE: sellviaProductsFile,
      SELLVIA_INVENTORY_FILE: sellviaInventoryFile,
      SELLVIA_PRICES_FILE: sellviaPricesFile,
      SYNC_ARTIFACTS_DIR: artifactsDir,
      SYNC_ENABLE_WRITES: "false",
    },
    async () => {
      const result = await runSync({ dryRun: "true", scope: "catalog,inventory,price" });
      assert.deepEqual(result.summary, {
        dryRun: true,
        scopes: ["catalog", "inventory", "price"],
        fetched: 5,
        created: 1,
        updated: 1,
        skipped: 0,
        failed: 0,
        rateLimited: 0,
        warnings: [
          "Skipped price mutation for external:sv-1 because SYNC_ENABLE_PRICE_WRITES is false.",
          "Skipped inventory mutation for external:sv-1 because SYNC_ENABLE_INVENTORY_WRITES is false.",
        ],
        errors: [],
      });

      const summaryFile = JSON.parse(await fs.readFile(path.join(artifactsDir, "summary.json"), "utf8"));
      assert.equal(summaryFile.created, 1);
      assert.equal(summaryFile.updated, 1);
      assert.equal(summaryFile.dryRun, true);
    },
  );
});
