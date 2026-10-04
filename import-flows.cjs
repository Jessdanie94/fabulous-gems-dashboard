/**
 * import-flows.cjs
 * Registers the dead-store webhook for STORE1. Paid orders go to the Render bridge.
 * Run once after deployment: node import-flows.cjs
 */
require('dotenv').config();
const https = require('https');

const STORE_DOMAIN = (process.env.SHOPIFY_STORE_URL || process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE1_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_STORE1_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
const APP_URL = process.env.SHOPIFY_APP_URL || 'https://fabulousgemsparlor-store.onrender.com';

if (!STORE_DOMAIN || !TOKEN) {
  console.error('❌ Store domain or admin token not set (SHOPIFY_STORE_URL / SHOPIFY_ADMIN_ACCESS_TOKEN)');
  process.exit(1);
}

function shopifyPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: STORE_DOMAIN,
      path,
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const WEBHOOKS = [
  { name: 'FLOW_3: Tag Dead Store Orders', topic: 'orders/create', address: `${APP_URL}/api/tag-dead-store-orders` },
];

(async () => {
  console.log('\n🚀 Importing Flows into STORE1...\n');
  console.log(`Store: ${STORE_DOMAIN}`);
  console.log(`App URL: ${APP_URL}\n`);

  for (const wh of WEBHOOKS) {
    console.log(`Registering webhook: ${wh.name}...`);
    const res = await shopifyPost(`/admin/api/${API_VERSION}/webhooks.json`, {
      webhook: { topic: wh.topic, address: wh.address, format: 'json' },
    });
    if (res.status === 201) {
      console.log(`  ✅ ${wh.name} → ${wh.topic} (ID: ${res.body.webhook.id})`);
    } else if (res.status === 422 && JSON.stringify(res.body).includes('already')) {
      console.log(`  ⚠️  ${wh.name} already registered`);
    } else {
      console.log(`  ❌ ${wh.name} failed: HTTP ${res.status} — ${JSON.stringify(res.body)}`);
    }
  }

  console.log('\n✅ Dead-store webhook imported. Register orders/paid with the Render bridge separately.\n');
})();
