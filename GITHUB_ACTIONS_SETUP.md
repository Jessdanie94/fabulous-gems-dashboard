# GitHub Actions CI/CD setup

The CI/CD workflow builds, tests, and deploys the dashboard to Render on pushes to `main`. To enable deployment:

1. Create a Render API key and find your Render service ID.
2. Add `RENDER_DEPLOY_KEY` and `RENDER_SERVICE_ID` as GitHub Actions repository secrets.
3. Set Shopify app credentials on the Render service: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, and `SHOPIFY_WEBHOOK_SECRET`. The Admin token needs `write_orders` for order tagging.
4. Run `npm test` and `npm run build` locally, then merge the branch to `main` and check the Actions and Render logs.

No Sellvia API key, sync workflow, or catalog-feed secrets are required. Shopify paid-order webhooks go to the Render bridge (`jesse-autopilot-bridge`); Sellvia's official Shopify app owns fulfillment. The bridge must preserve the original body and HMAC header if it forwards to `/api/auto-fulfill`.

If a deploy fails, inspect the Actions run, confirm Render secrets/service ID, and check Render logs.
