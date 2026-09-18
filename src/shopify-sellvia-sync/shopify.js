import fs from 'node:fs/promises';
import path from 'node:path';
import { requestWithRetry } from './http.js';

function parseLinkHeader(value) {
  if (!value) return null;
  const nextPart = value
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.includes('rel="next"'));
  if (!nextPart) return null;
  const match = nextPart.match(/<([^>]+)>/);
  return match?.[1] || null;
}

function shopifyUrl(config, pathname) {
  return `https://${config.shopifyStoreDomain}/admin/api/2025-01${pathname}`;
}

export function createShopifyClient(config) {
  const headers = {
    'X-Shopify-Access-Token': config.shopifyAccessToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  return {
    async listProducts() {
      if (config.shopifyProductsFixturePath) {
        const fixture = await fs.readFile(path.resolve(config.shopifyProductsFixturePath), 'utf8');
        const parsed = JSON.parse(fixture);
        return Array.isArray(parsed) ? parsed : parsed.products || parsed.items || [];
      }

      const products = [];
      let nextUrl = `${shopifyUrl(config, '/products.json')}?limit=250&fields=id,title,body_html,vendor,product_type,handle,status,tags,variants`;
      let iteration = 0;

      while (nextUrl && iteration < 100) {
        const response = await requestWithRetry(nextUrl, { headers }, config.requestRuntime);
        const payload = await response.json();
        products.push(...(payload.products || []));
        nextUrl = parseLinkHeader(response.headers?.get?.('link'));
        iteration += 1;
      }

      return products;
    },

    async getPrimaryLocationId() {
      if (config.shopifyProductsFixturePath) return config.shopifyLocationId || 'fixture-location';
      if (config.shopifyLocationId) return config.shopifyLocationId;
      const response = await requestWithRetry(shopifyUrl(config, '/locations.json?limit=250'), { headers }, config.requestRuntime);
      const payload = await response.json();
      const location = (payload.locations || []).find((entry) => entry.active !== false);
      return location?.id ? String(location.id) : null;
    },

    async createProduct(product) {
      const response = await requestWithRetry(
        shopifyUrl(config, '/products.json'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ product }),
        },
        config.requestRuntime,
      );
      const payload = await response.json();
      return payload.product;
    },

    async updateProduct(id, product) {
      const response = await requestWithRetry(
        shopifyUrl(config, `/products/${id}.json`),
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ product: { id, ...product } }),
        },
        config.requestRuntime,
      );
      const payload = await response.json();
      return payload.product;
    },

    async updateVariant(id, variant) {
      const response = await requestWithRetry(
        shopifyUrl(config, `/variants/${id}.json`),
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ variant: { id, ...variant } }),
        },
        config.requestRuntime,
      );
      const payload = await response.json();
      return payload.variant;
    },

    async setInventoryLevel(inventoryItemId, locationId, available) {
      const response = await requestWithRetry(
        shopifyUrl(config, '/inventory_levels/set.json'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            location_id: Number(locationId),
            inventory_item_id: Number(inventoryItemId),
            available,
          }),
        },
        config.requestRuntime,
      );
      return response.json();
    },
  };
}
