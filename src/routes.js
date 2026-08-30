const express = require('express');
const router = express.Router();
const { getOrders, getProducts } = require('../jdv-core-orchestrator');

router.get('/orders', async (req, res) => {
  try {
    const orders = await getOrders();
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/products', async (req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
