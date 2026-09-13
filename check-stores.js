require('dotenv').config();
const https = require('https');

const stores = [
  { name: 'STORE1', domain: process.env.SHOPIFY_STORE1_DOMAIN, token: process.env.SHOPIFY_STORE1_TOKEN },
  { name: 'STORE2', domain: process.env.SHOPIFY_STORE2_DOMAIN, token: process.env.SHOPIFY_STORE2_TOKEN },
  { name: 'STORE3', domain: process.env.SHOPIFY_STORE3_DOMAIN, token: process.env.SHOPIFY_STORE3_TOKEN },
];

function checkStore(store) {
  return new Promise((resolve) => {
    if (!store.domain || !store.token) {
      console.log(`⚠️  STORE #${store.name.slice(-1)}: Not configured (missing domain or token)`);
      return resolve({ store, status: 'not_configured' });
    }
    const options = {
      hostname: store.domain.replace('https://', '').replace('/', ''),
      path: '/admin/api/2024-01/shop.json',
      method: 'GET',
      headers: { 'X-Shopify-Access-Token': store.token, 'Content-Type': 'application/json' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const shop = JSON.parse(data).shop;
          console.log(`✅ STORE #${store.name.slice(-1)} FIXED — ${shop.name} (${shop.myshopify_domain}) [ID: ${shop.id}]`);
          resolve({ store, status: 'ok', shopId: shop.id, shopName: shop.name });
        } else {
          console.log(`❌ STORE #${store.name.slice(-1)} FAILED — HTTP ${res.statusCode}: ${data}`);
          resolve({ store, status: 'error', code: res.statusCode });
        }
      });
    });
    req.on('error', (e) => {
      console.log(`❌ STORE #${store.name.slice(-1)} ERROR — ${e.message}`);
      resolve({ store, status: 'error', message: e.message });
    });
    req.end();
  });
}

(async () => {
  console.log('\n🔍 Checking Shopify store connections...\n');
  const results = [];
  for (const store of stores) {
    results.push(await checkStore(store));
  }
  console.log('\n--- Summary ---');
  const ok = results.filter(r => r.status === 'ok');
  console.log(`${ok.length}/${stores.length} stores connected.`);
})();
