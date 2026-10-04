require('dotenv').config();
const axios = require('axios');

const STORE = (process.env.SHOPIFY_STORE_URL || process.env.SHOPIFY_STORE_DOMAIN || '').replace(/^https?:\/\//, '');
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_API_TOKEN;

const shopify = axios.create({
  baseURL: `https://${STORE}/admin/api/${process.env.SHOPIFY_API_VERSION || '2026-07'}`,
  headers: { 'X-Shopify-Access-Token': TOKEN }
});

async function getOrders() {
  const res = await shopify.get('/orders.json?status=any&limit=10');
  return res.data.orders;
}

async function getProducts() {
  const res = await shopify.get('/products.json?limit=10');
  return res.data.products;
}

module.exports = { shopify, getOrders, getProducts };
