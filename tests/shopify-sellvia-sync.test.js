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

test("planProductChanges fails closed for ambiguous Shopify identities", () => {
  assert.throws(
    () =>
      planProductChanges(
        [{ sku: "RING-1", title: "Gold Ring" }],
        [
          {
            id: 10,
            title: "Gold Ring",
            handle: "gold-ring",
            tags: "",
            variants: [{ id: 20, sku: "RING-1", price: "19.99", inventory_quantity: 5 }],
          },
          {
            id: 11,
            title: "Gold Ring Copy",
            handle: "gold-ring-copy",
            tags: "",
            variants: [{ id: 21, sku: "RING-1", price: "19.99", inventory_quantity: 5 }],
          },
        ],
      ),
    /Ambiguous Shopify mapping detected for sku:ring-1/,
  );
});

test("planProductChanges restricts updates to the selected scopes", () => {
  const plan = planProductChanges(
    [{ id: "sv-1", sku: "RING-1", title: "Gold Ring Deluxe", handle: "ring-1", price: "29.99", inventory: 8 }],
    [
      {
        id: 10,
        title: "Gold Ring",
        handle: "gold-ring",
        tags: "sellvia-id:sv-1",
        variants: [{ id: 20, sku: "RING-1", price: "19.99", inventory_quantity: 5 }],
      },
    ],
    {
      allowCreates: false,
      includeTitle: false,
      includeHandle: false,
      includePrice: false,
      includeInventory: true,
    },
  );

  assert.equal(plan[0].action, "update");
  assert.deepEqual(plan[0].updates.map((update) => update.field), ["inventory"]);
});

test("planProductChanges disallows creates outside catalog scope", () => {
  assert.throws(
    () =>
      planProductChanges(
        [{ sku: "RING-2", inventory: 4 }],
        [],
        {
          allowCreates: false,
          includeTitle: false,
          includeHandle: false,
          includePrice: false,
          includeInventory: true,
        },
      ),
    /Catalog creation is disabled/,
  );
});

test("planProductChanges fails closed for invalid external data", () => {
  assert.throws(
    () => planProductChanges([{ sku: "BROKEN", title: "Broken", price: -1 }], []),
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

test("requestWithRetry does not retry unsafe POST requests", async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
  };

  try {
    const { response, attempts: usedAttempts } = await requestWithRetry(
      "https://example.com/products?token=secret",
      { method: "POST" },
      { maxRetries: 2, backoffMs: 0, timeoutMs: 1000 },
    );
    assert.equal(response.status, 503);
    assert.equal(usedAttempts, 1);
    assert.equal(attempts, 1);
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
        updated: 0,
        skipped: 1,
        failed: 0,
        rateLimited: 0,
        warnings: [
          "Skipped price mutation for external:sv-1 because SYNC_ENABLE_PRICE_WRITES is false.",
          "Skipped inventory mutation for external:sv-1 because SYNC_ENABLE_INVENTORY_WRITES is false.",
          "Deferred price on create for external:sv-2 because SYNC_ENABLE_PRICE_WRITES is false.",
          "Deferred inventory on create for external:sv-2 because SYNC_ENABLE_INVENTORY_WRITES is false.",
        ],
        errors: [],
      });

      const summaryFile = JSON.parse(await fs.readFile(path.join(artifactsDir, "summary.json"), "utf8"));
      assert.equal(summaryFile.created, 1);
      assert.equal(summaryFile.updated, 0);
      assert.equal(summaryFile.dryRun, true);
    },
  );
});

test("runSync creates products without price writes and applies inventory separately", async () => {
  const originalFetch = global.fetch;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sellvia-sync-create-"));
  const sellviaProductsFile = path.join(tempDir, "sellvia-products.json");
  const sellviaInventoryFile = path.join(tempDir, "sellvia-inventory.json");
  const sellviaPricesFile = path.join(tempDir, "sellvia-prices.json");
  const artifactsDir = path.join(tempDir, "artifacts");
  const requests = [];

  await fs.writeFile(
    sellviaProductsFile,
    JSON.stringify([{ id: "sv-2", sku: "RING-2", title: "Silver Ring", handle: "silver-ring", price: "14.99", inventory: 7 }]),
  );
  await fs.writeFile(
    sellviaInventoryFile,
    JSON.stringify([{ id: "sv-2", sku: "RING-2", inventory: 7 }]),
  );
  await fs.writeFile(
    sellviaPricesFile,
    JSON.stringify([{ id: "sv-2", sku: "RING-2", price: "14.99" }]),
  );

  global.fetch = async (url, init = {}) => {
    requests.push({ url, init });

    if (String(url).includes("/products.json?limit=250")) {
      return new Response(JSON.stringify({ products: [] }), { status: 200, headers: { link: "" } });
    }

    if (String(url).includes("/products.json")) {
      return new Response(
        JSON.stringify({ product: { id: 10, variants: [{ id: 20, inventory_item_id: 30 }] } }),
        { status: 201 },
      );
    }

    if (String(url).includes("/inventory_levels/set.json")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await withEnv(
      {
        SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
        SHOPIFY_API_TOKEN: "shopify-token",
        SELLVIA_MASTER_KEY: "sellvia-token",
        SELLVIA_PRODUCTS_FILE: sellviaProductsFile,
        SELLVIA_INVENTORY_FILE: sellviaInventoryFile,
        SELLVIA_PRICES_FILE: sellviaPricesFile,
        SYNC_ARTIFACTS_DIR: artifactsDir,
        SYNC_ENABLE_WRITES: "true",
        SYNC_ENABLE_PRICE_WRITES: "false",
        SYNC_ENABLE_INVENTORY_WRITES: "true",
        SYNC_APPROVE_BULK_CHANGES: "true",
        SHOPIFY_LOCATION_ID: "123",
      },
      async () => {
        const result = await runSync({ dryRun: "false", scope: "catalog,inventory,price" });
        assert.equal(result.summary.created, 1);
        assert.equal(result.summary.failed, 0);
      },
    );

    const createRequest = requests.find(
      ({ url, init }) => String(url).endsWith("/products.json") && (init.method || "GET") === "POST",
    );
    const inventoryRequest = requests.find(({ url }) => String(url).includes("/inventory_levels/set.json"));

    assert.ok(createRequest);
    assert.ok(inventoryRequest);

    const createBody = JSON.parse(createRequest.init.body);
    assert.equal(createBody.product.variants[0].sku, "RING-2");
    assert.equal("price" in createBody.product.variants[0], false);
    assert.equal(createBody.product.variants[0].inventory_management, "shopify");

    const inventoryBody = JSON.parse(inventoryRequest.init.body);
    assert.equal(inventoryBody.available, 7);
    assert.equal(inventoryBody.location_id, 123);
    assert.equal(inventoryBody.inventory_item_id, 30);
  } finally {
    global.fetch = originalFetch;
  }
});

test("runSync preserves action artifacts after per-action failures", async () => {
  const originalFetch = global.fetch;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sellvia-sync-failure-"));
  const sellviaProductsFile = path.join(tempDir, "sellvia-products.json");
  const artifactsDir = path.join(tempDir, "artifacts");
  let createAttempts = 0;

  await fs.writeFile(
    sellviaProductsFile,
    JSON.stringify([{ id: "sv-2", sku: "RING-2", title: "Silver Ring", handle: "silver-ring", price: "14.99" }]),
  );

  global.fetch = async (url) => {
    if (String(url).includes("/products.json?limit=250")) {
      return new Response(JSON.stringify({ products: [] }), { status: 200, headers: { link: "" } });
    }

    if (String(url).includes("/products.json")) {
      createAttempts += 1;
      return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await withEnv(
      {
        SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
        SHOPIFY_API_TOKEN: "shopify-token",
        SELLVIA_MASTER_KEY: "sellvia-token",
        SELLVIA_PRODUCTS_FILE: sellviaProductsFile,
        SYNC_ARTIFACTS_DIR: artifactsDir,
        SYNC_ENABLE_WRITES: "true",
        SYNC_APPROVE_BULK_CHANGES: "true",
      },
      async () => {
        await assert.rejects(
          () => runSync({ dryRun: "false", scope: "catalog" }),
          (error) => {
            assert.equal(error.summary.failed, 1);
            assert.equal(error.summary.errors[0], "external:sv-2: Failed to create Shopify product for external:sv-2");
            return true;
          },
        );
      },
    );

    assert.equal(createAttempts, 1);

    const detailsFile = JSON.parse(await fs.readFile(path.join(artifactsDir, "details.json"), "utf8"));
    assert.equal(detailsFile.fatal, undefined);
    assert.equal(detailsFile.actions.length, 1);
    assert.equal(detailsFile.actions[0].action, "create");
  } finally {
    global.fetch = originalFetch;
  }
});
