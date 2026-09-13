require('dotenv').config();
const https = require('https');

const BILLING_IDS = ['5809673777', '574805867'];

const stores = [
  { name: 'STORE1', domain: process.env.SHOPIFY_STORE1_DOMAIN, token: process.env.SHOPIFY_STORE1_TOKEN },
  { name: 'STORE2', domain: process.env.SHOPIFY_STORE2_DOMAIN, token: process.env.SHOPIFY_STORE2_TOKEN },
  { name: 'STORE3', domain: process.env.SHOPIFY_STORE3_DOMAIN, token: process.env.SHOPIFY_STORE3_TOKEN },
];

function shopifyGet(domain, token, path) {
  return new Promise((resolve, reject) => {
    const hostname = domain.replace('https://', '').replace('/', '');
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(data));
        else resolve(null);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('\n🔍 Searching for billing IDs:', BILLING_IDS.join(', '), '\n');
  for (const store of stores) {
    if (!store.domain || !store.token) continue;
    console.log(`Checking ${store.name} (${store.domain})...`);
    try {
      const shopData = await shopifyGet(store.domain, store.token, '/admin/api/2024-01/shop.json');
      if (!shopData) { console.log(`  ❌ Could not connect\n`); continue; }
      const shopId = String(shopData.shop.id);
      if (BILLING_IDS.includes(shopId)) {
        console.log(`  🎯 MATCH! ${store.name} ID ${shopId} === billing ID — this is the store that charged you.`);
        console.log(`     Store: ${shopData.shop.name} (${shopData.shop.myshopify_domain})\n`);
      } else {
        console.log(`  Store ID: ${shopId} — no match\n`);
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}\n`);
    }
  }
})();
