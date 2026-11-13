# Setup Map

Maps VS Code profiles, GitHub repos, and platform sides. Items marked **TODO** are unconfirmed.

## Architecture

One pipeline, not two separate stores:

Shopify (storefront, sells) -> this dashboard/sync -> Sellvia (supplier, fulfills)

Profit = Shopify sale price - Sellvia cost - fees.

## Profiles and repos

| VS Code profile | GitHub repo | Real identity / role |
|---|---|---|
| `fabulous-gems` | `Jessdanie94/fabulous-gems` (this dashboard repo is `Jessdanie94/fabulous-gems-dashboard`) | `jesse-s-digital-ventures/jesse-autopilot-bridge` on the Shopify side |
| TODO | TODO | TODO |

## Shopify side

- Org/repo: `jesse-s-digital-ventures/jesse-autopilot-bridge`
- Store domain: **TODO**
- Token secret: `SHOPIFY_ADMIN_ACCESS_TOKEN` (or legacy `SHOPIFY_API_TOKEN`)

## Sellvia side

- Not a repo; it is a supplier account.
- Credential: `SELLVIA_API_KEY` (or `SELLVIA_MASTER_KEY`)
- API availability: **TODO** confirm with Sellvia (the `https://api.sellvia.com` default is unverified)
- Feed endpoints (**TODO**, account-specific): `SELLVIA_PRODUCTS_URL`, `SELLVIA_INVENTORY_URL`, `SELLVIA_PRICES_URL`, `SELLVIA_ORDERS_URL`

## Launch checklist

- [ ] Confirm Sellvia API/feed access and fill in the endpoints
- [ ] Add secrets to GitHub Actions
- [ ] Run `verify-api.sh`
- [ ] Sync a small hand-picked catalog and check margins
- [ ] Place one test order end to end before enabling order writes
