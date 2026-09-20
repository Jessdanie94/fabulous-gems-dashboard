#!/usr/bin/env node
/**
 * scripts/sellvia-sync.js
 *
 * Standalone Sellvia inventory sync script.
 * Called by the `sync:sellvia` npm script, which in turn is invoked by
 * the GitHub Actions workflow (.github/workflows/shopify-sellvia-sync.yml)
 * on a 30-minute cron schedule.
 *
 * Environment variables required:
 *   SELLVIA_MASTER_KEY     — Sellvia API key
 *   SHOPIFY_STORE_DOMAIN   — fabulousgemsparlor.myshopify.com
 *   SHOPIFY_ADMIN_ACCESS_TOKEN — store admin access token
 */

const https = require('https');

const SELLVIA_BASE_URL = 'api.sellvia.com';
const SELLVIA_KEY = process.env.SELLVIA_MASTER_KEY;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

if (!SELLVIA_KEY) {
  console.error('ERROR: SELLVIA_MASTER_KEY is not set');
  process.exit(1);
}
if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must both be set');
  process.exit(1);
}

/**
 * Simple promisified HTTPS request helper
 */
function request(hostname, path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method, headers };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Fetch Sellvia products (inventory source)
 */
async function fetchSellviaProducts() {
  console.log('Fetching Sellvia product catalog...');
  const res = await request(
    SELLVIA_BASE_URL,
    '/api/v1/products?per_page=250&page=1',
    'GET',
    {
      Authorization: `Bearer ${SELLVIA_KEY}`,
      'Content-Type': 'application/json',
    }
  );
  if (res.status !== 200) {
    throw new Error(`Sellvia products fetch failed: HTTP ${res.status}`);
  }
  const products = res.body.data || res.body.products || [];
  console.log(`  Found ${products.length} Sellvia products`);
  return products;
}

/**
 * Fetch current Shopify inventory levels for fabulousgemsparlor.store
 */
async function fetchShopifyInventory() {
  console.log('Fetching Shopify inventory levels...');
  const hostname = SHOPIFY_DOMAIN.replace('https://', '');
  const res = await request(
    hostname,
    '/admin/api/2024-01/inventory_levels.json?limit=250',
    'GET',
    {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    }
  );
  if (res.status !== 200) {
    throw new Error(`Shopify inventory fetch failed: HTTP ${res.status}`);
  }
  const levels = res.body.inventory_levels || [];
  console.log(`  Found ${levels.length} Shopify inventory levels`);
  return levels;
}

/**
 * Main sync: pull Sellvia stock quantities and push to Shopify.
 * Matches products by SKU. Only updates items where quantity differs.
 */
async function runSync() {
  console.log(`\n[${new Date().toISOString()}] Starting Sellvia → Shopify inventory sync`);
  console.log(`  Store: ${SHOPIFY_DOMAIN}`);

  const [sellviaProducts, shopifyLevels] = await Promise.all([
    fetchSellviaProducts(),
    fetchShopifyInventory(),
  ]);

  // Build a lookup of Sellvia stock by SKU
  const sellviaStock = {};
  for (const product of sellviaProducts) {
    const variants = product.variants || [];
    for (const variant of variants) {
      if (variant.sku) {
        sellviaStock[variant.sku] = variant.quantity ?? variant.stock ?? 0;
      }
    }
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  const hostname = SHOPIFY_DOMAIN.replace('https://', '');

  for (const level of shopifyLevels) {
    const sku = level.sku;
    if (!sku || !(sku in sellviaStock)) {
      skipped++;
      continue;
    }

    const newQty = sellviaStock[sku];
    if (level.available === newQty) {
      skipped++;
      continue;
    }

    // Adjust inventory to match Sellvia stock
    const res = await request(
      hostname,
      '/admin/api/2024-01/inventory_levels/set.json',
      'POST',
      {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
      {
        location_id: level.location_id,
        inventory_item_id: level.inventory_item_id,
        available: newQty,
      }
    );

    if (res.status === 200) {
      console.log(`  Updated SKU ${sku}: ${level.available} → ${newQty}`);
      updated++;
    } else {
      console.error(`  Failed to update SKU ${sku}: HTTP ${res.status}`);
      errors++;
    }
  }

  console.log(`\nSync complete: ${updated} updated, ${skipped} skipped, ${errors} errors`);

  if (errors > 0) {
    process.exit(1);
  }
}

runSync().catch((err) => {
  console.error('Sync failed with error:', err.message);
  process.exit(1);
});
