const API_VERSION = "2025-01";

// Credentials are read per request so rotated secrets are picked up without a restart.
async function shopifyGet(path) {
  const store = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_API_TOKEN;
  if (!store || !token) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_API_TOKEN");
  }
  const res = await fetch(`https://${store}/admin/api/${API_VERSION}${path}`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!res.ok) {
    throw new Error(`Shopify request failed with HTTP ${res.status}`);
  }
  return res.json();
}

export async function getOrders() {
  return (await shopifyGet("/orders.json?status=any&limit=10")).orders;
}

export async function getProducts() {
  return (await shopifyGet("/products.json?limit=10")).products;
}
