# Fabulous Gems Dashboard deployment checklist

## Shopify and Sellvia

- [ ] Install the Shopify app and grant `read_orders,write_orders,read_products,read_finances`.
- [ ] Set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and `SCOPES`.
- [ ] Set `SHOPIFY_STORE_DOMAIN` (the `.myshopify.com` domain), `SHOPIFY_ADMIN_ACCESS_TOKEN` (with `write_orders`), and `SHOPIFY_WEBHOOK_SECRET` on the webhook-handling service.
- [ ] Install and configure Sellvia's official Shopify app for fulfillment and tracking. No Sellvia REST API key or feed URLs are required.
- [ ] Register Shopify's `orders/paid` webhook to the Render bridge (`jesse-autopilot-bridge`). If forwarding to `/api/auto-fulfill`, preserve the original raw body and `X-Shopify-Hmac-Sha256` header. Do not register an additional paid-order webhook through `import-flows.cjs`.

## Deployment

- [ ] Configure Render with the Shopify env vars and database config from `.env.example`; never commit `.env`.
- [ ] Set `RENDER_DEPLOY_KEY` and `RENDER_SERVICE_ID` as GitHub Actions secrets for the deployment pipeline.
- [ ] Run `npm install`, `npm run setup`, `npm test`, and `npm run build`.
- [ ] Deploy the branch and verify the app responds and Shopify authentication works.

## Live verification

- [ ] Send a signed test `orders/paid` webhook to the bridge and confirm the order is tagged `sellvia-queued` in Shopify. A queue tag does **not** mean fulfilled.
- [ ] Verify Sellvia's Shopify app creates the actual fulfillment/tracking automatically.
- [ ] Confirm the dashboard displays Shopify payout data, and monitor bridge/Render logs for errors.
