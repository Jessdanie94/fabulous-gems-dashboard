# Fabulous Gems Dashboard

Shopify dashboard for payouts and order webhook tagging. Sellvia fulfillment runs through Sellvia's official Shopify app, not a public Sellvia REST API.

## Order flow

1. Shopify sends signed `orders/paid` webhooks to the Render bridge (`jesse-autopilot-bridge`).
2. The bridge processes/logs orders and forwards the original signed webhook (raw body and `X-Shopify-Hmac-Sha256` header) to `/api/auto-fulfill` when using this dashboard route.
3. The route verifies the signature with `SHOPIFY_WEBHOOK_SECRET`, validates the order ID, and adds the `sellvia-queued` tag using Shopify Admin GraphQL `tagsAdd` (requires `write_orders`). It logs the order ID and returns 200 only after successful tagging. Shopify webhook retries are safe because `tagsAdd` is idempotent.
4. Sellvia's official Shopify app handles fulfillment and tracking. A queue tag is *not* evidence of fulfillment.

The old ad-spend circuit breaker, inventory-triggered campaign pausing, dashboard Sellvia analytics service, and scheduled catalog sync relied on nonexistent Sellvia REST endpoints and have been removed. Manage Sellvia ads in its dashboard.

## Setup

- Node.js 20.19+ or 22.12+, Shopify Partner app, and Shopify Admin token with `write_orders` scope.
- Copy `.env.example` to `.env`; set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, and `SHOPIFY_WEBHOOK_SECRET`.
- Configure the paid-order webhook on the Render bridge; do not register a second direct subscription via `import-flows.cjs`.
- Install and run: `npm install`, `npm run setup`, `npm run build`, `npm start`.
- Run tests with `npm test`; check types with `npm run typecheck`.

The dashboard's remaining payout metrics are fetched from Shopify. No Sellvia API keys, feed URLs, or manual fulfillment calls are needed.
