require('dotenv').config();
const https = require('https');

const STORE = {
  domain: process.env.SHOPIFY_STORE1_DOMAIN,
  token: process.env.SHOPIFY_STORE1_TOKEN,
  sellviaKey: process.env.SELLVIA_MASTER_KEY,
};

const DAILY_BUDGET = 10;

function sellviaRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.sellvia.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${STORE.sellviaKey}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('\n🔧 Applying STORE1 safe mode...\n');

  if (!STORE.domain || !STORE.token) {
    console.error('❌ SHOPIFY_STORE1_DOMAIN or SHOPIFY_STORE1_TOKEN not set in .env');
    process.exit(1);
  }
  if (!STORE.sellviaKey) {
    console.error('❌ SELLVIA_MASTER_KEY not set in .env');
    process.exit(1);
  }

  console.log('1. Fetching Sellvia campaigns...');
  const campaigns = await sellviaRequest('/api/v1/campaigns');
  if (campaigns.status !== 200) {
    console.log(`   ⚠️  Could not fetch campaigns (HTTP ${campaigns.status}). Manual action required at sellvia.com`);
  } else {
    const list = campaigns.body.data || campaigns.body;
    console.log(`   Found ${list.length} campaigns`);

    for (const campaign of list) {
      const name = campaign.name || campaign.title || '';
      const id = campaign.id;

      if (name.toLowerCase().includes('all-product') || name.toLowerCase().includes('all product')) {
        console.log(`\n2. Pausing All-Product campaign: "${name}" (ID: ${id})...`);
        const pause = await sellviaRequest(`/api/v1/campaigns/${id}/pause`, 'POST');
        console.log(`   Status: ${pause.status === 200 ? '✅ PAUSED' : `⚠️  HTTP ${pause.status} — may need manual pause`}`);
      } else {
        console.log(`\n3. Setting $${DAILY_BUDGET}/day budget on: "${name}" (ID: ${id})...`);
        const update = await sellviaRequest(`/api/v1/campaigns/${id}`, 'PATCH', {
          daily_budget: DAILY_BUDGET,
          accelerated: false,
          remarketing: false,
          boosters: false,
        });
        console.log(`   Status: ${update.status === 200 ? `✅ $${DAILY_BUDGET}/day, boosters OFF` : `⚠️  HTTP ${update.status}`}`);
      }
    }
  }

  console.log('\n✅ Done. Verify at sellvia.com that All-Product is grey and individual campaigns show $10/day.');
})();
