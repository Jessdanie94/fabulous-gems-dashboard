# Fabulous Gems Dashboard

A comprehensive Shopify Payout Dashboard with integrated Sellvia revenue analytics for fabulousgemsparlor.store.

## Features

### 📊 Revenue Analytics
- **Real-time Shopify Balance** - Pending payout from Shopify Payments
- **Monthly Revenue Tracking** - Combined data from Sellvia and Shopify
- **Order Analytics** - Total orders and average order value metrics
- **Customer Insights** - Unique visitors and conversion rate tracking
- **Top Products** - Best-performing products by revenue and units sold
- **Payout History** - Last 10 payouts from Shopify Payments

### 🔗 Integrations
- **Shopify Finances API** - Real payout data and balance tracking
- **Sellvia Master Key** - Revenue and analytics data aggregation
- **Shopify GraphQL Admin API** - Direct store data access

## Tech Stack

- [Remix](https://remix.run) - Full-stack React framework
- [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix) - Shopify app framework
- [Shopify Polaris](https://polaris.shopify.com/) - UI component library
- [Prisma](https://www.prisma.io/) - Database ORM (SQLite)
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vite](https://vitejs.dev/) - Build tool

## Prerequisites

Before you begin, ensure you have:

1. **Node.js** - v20.19+ or v22.12+ ([Download](https://nodejs.org/))
2. **Shopify Partner Account** - [Create here](https://partners.shopify.com/signup)
3. **Shopify CLI** - [Install here](https://shopify.dev/docs/apps/tools/cli/getting-started)
4. **Development Store** - [Create here](https://help.shopify.com/en/partners/dashboard/development-stores)
5. **Sellvia Master Key** - Available from your Sellvia dashboard

## Setup

### 1. Install Dependencies

```bash
npm install
# or
pnpm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```env
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SHOPIFY_APP_URL=https://your-app-url.onrender.com
SCOPES=read_orders,read_products,read_finances
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_API_TOKEN=your_shopify_admin_access_token_here
SHOPIFY_ADMIN_ACCESS_TOKEN=your_shopify_admin_access_token_here
SHOPIFY_LOCATION_ID=your_shopify_location_id_here
SELLVIA_MASTER_KEY=your_sellvia_master_key_here
SELLVIA_API_KEY=your_sellvia_api_key_here
SELLVIA_API_BASE_URL=https://api.sellvia.com
SELLVIA_PRODUCTS_URL=https://sellvia.example.com/catalog/products
SELLVIA_INVENTORY_URL=https://sellvia.example.com/catalog/inventory
SELLVIA_PRICES_URL=https://sellvia.example.com/catalog/prices
SELLVIA_ORDERS_URL=https://sellvia.example.com/orders
SYNC_DRY_RUN=true
SYNC_SCOPE=catalog,inventory,price
SYNC_ENABLE_WRITES=false
SYNC_ENABLE_PRICE_WRITES=false
SYNC_ENABLE_INVENTORY_WRITES=false
SYNC_ENABLE_ORDER_WRITES=false
SYNC_APPROVE_BULK_CHANGES=false
```

**Environment Variable Details:**

- `SHOPIFY_API_KEY` - Found in your Shopify Partner dashboard
- `SHOPIFY_API_SECRET` - Found in your Shopify Partner dashboard
- `SHOPIFY_APP_URL` - Your app's deployment URL
- `SCOPES` - Required permissions for the embedded app UI
  - `read_orders` - View orders
  - `read_products` - View products
  - `read_finances` - Access payout and balance data
- `SHOPIFY_STORE_DOMAIN` - Store domain for autonomous sync runs
- `SHOPIFY_API_TOKEN` / `SHOPIFY_ADMIN_ACCESS_TOKEN` - Admin API token used by the sync workflow (`SHOPIFY_API_TOKEN` is the legacy alias)
- `SHOPIFY_LOCATION_ID` - Required before inventory write mode is enabled
- `SELLVIA_MASTER_KEY` / `SELLVIA_API_KEY` - Sellvia credential used by the dashboard and sync adapter
- `SELLVIA_PRODUCTS_URL`, `SELLVIA_INVENTORY_URL`, `SELLVIA_PRICES_URL` - Account-specific Sellvia feed endpoints for product, stock, and price data
- `SELLVIA_ORDERS_URL` - Optional order feed endpoint; order writes stay disabled until the contract is validated
- `SYNC_*` flags - Safety controls for dry runs, write enablement, and bulk approval

### 3. Set Up Database

```bash
npm run setup
```

This runs:
- `prisma generate` - Generate Prisma client
- `prisma migrate deploy` - Apply database migrations

### 4. Link Your App

```bash
shopify app config link
```

## Local Development

### Start Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

### Start Production Server

```bash
npm start
```

## Docker Deployment

### Build Docker Image

```bash
docker build -t fabulous-gems-dashboard .
```

### Run Docker Container

```bash
docker run -p 3000:3000 \
  -e SHOPIFY_API_KEY=your_key \
  -e SHOPIFY_API_SECRET=your_secret \
  -e SHOPIFY_APP_URL=https://your-url \
  -e SELLVIA_MASTER_KEY=your_key \
  fabulous-gems-dashboard
```

## Project Structure

```
fabulous-gems-dashboard/
├── app/
│   ├── routes/
│   │   └── app._index.tsx        # Main dashboard page
│   ├── services/
│   │   ├── shopify-finances.server.ts  # Shopify API integration
│   │   └── sellvia.server.ts           # Sellvia API integration
│   ├── db.server.ts               # Prisma database setup
│   └── shopify.server.ts          # Shopify app configuration
├── prisma/
│   └── schema.prisma              # Database schema
├── public/                         # Static assets
├── extensions/                     # Shopify app extensions
├── package.json
└── vite.config.ts
```

## Autonomous Shopify + Sellvia Sync

The repository now includes a production-safe sync control plane driven by `node shopify-sellvia-sync.js` and the GitHub Actions workflow at `.github/workflows/shopify-sellvia-sync.yml`.

### Architecture and Data Flow

1. GitHub Actions triggers the sync every 30 minutes or on manual dispatch.
2. The workflow validates required secrets without printing them.
3. `check-stores.js` loads `.env` locally when present, then delegates to `src/shopify-sellvia-sync.js`.
4. The sync adapter reads Sellvia catalog/inventory/price feeds from account-specific URLs or local fixture files.
5. Shopify products are fetched via the Admin REST API with pagination and bounded retries.
6. Products are mapped deterministically by `sellvia-id:{externalId}` tag, then SKU, then handle.
7. The sync computes an idempotent plan, writes only when explicit safety flags are enabled, and never performs destructive deletes.
8. Each run writes `summary.json`, `details.json`, and `summary.md` into `artifacts/shopify-sellvia-sync/` for auditability and troubleshooting.

### Conflict Policy and Safety Controls

- **Fail closed** when required credentials, source endpoints, or identity fields are missing.
- **No destructive deletes** are implemented.
- **Dry-run is the default** for scheduled runs.
- **Writes require explicit opt-in** using `SYNC_ENABLE_WRITES=true`.
- **Price writes** additionally require `SYNC_ENABLE_PRICE_WRITES=true`.
- **Inventory writes** additionally require `SYNC_ENABLE_INVENTORY_WRITES=true` and `SHOPIFY_LOCATION_ID`.
- **Bulk or high-risk mutations** require `SYNC_APPROVE_BULK_CHANGES=true`.
- **Order writes remain disabled by default** until the Sellvia order contract and required Shopify scopes are verified.
- Logs and artifacts only contain summary metadata; tokens and customer/order payloads are intentionally excluded.

### Required Secrets and Permissions

Configure these as **GitHub Actions secrets** for autonomous runs:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_TOKEN` or `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SELLVIA_MASTER_KEY` or `SELLVIA_API_KEY`
- `SELLVIA_PRODUCTS_URL`
- `SELLVIA_INVENTORY_URL`
- `SELLVIA_PRICES_URL`

Optional but supported:

- `SHOPIFY_LOCATION_ID` (required for inventory writes)
- `SELLVIA_API_BASE_URL`
- `SELLVIA_ORDERS_URL`
- `SYNC_FAILURE_WEBHOOK_URL`

Recommended Shopify Admin API scopes for write mode are `read_products`, `write_products`, and inventory-related scopes required by your token issuer. Keep order scopes read-only until order reconciliation is contract-tested for your account.

### Exact Setup Steps

1. Add the required GitHub Actions secrets listed above.
2. Confirm the Sellvia product, inventory, and pricing feeds return stable identifiers (`externalId`/`id`, `sku`, or `handle`).
3. Run a **manual** workflow dispatch with `dry_run=true` and `scope=all` (or `catalog,inventory,price`).
4. Review the workflow summary plus `artifacts/shopify-sellvia-sync/*`.
5. Resolve any identity conflicts or missing mappings before enabling writes.
6. Enable `SYNC_ENABLE_WRITES=true` only after the dry-run plan is stable.
7. Enable `SYNC_ENABLE_PRICE_WRITES=true` and/or `SYNC_ENABLE_INVENTORY_WRITES=true` separately when those mutations have been validated.

### Workflow Inputs and Operation

Manual `workflow_dispatch` supports:

- `dry_run` - boolean; leave `true` until the write plan is proven safe.
- `scope` - one of `all`, `catalog`, `inventory`, `price`, `orders`, or `catalog,inventory,price`.

Scheduled runs execute every 30 minutes with `SYNC_DRY_RUN=true` by default.

### Dry-Run to Write-Mode Promotion Procedure

1. Start with scheduled dry-run only.
2. Run multiple manual dry-runs and verify `created`, `updated`, `skipped`, `failed`, and `rateLimited` counts.
3. Confirm that mapped Shopify products carry the expected `sellvia-id:{externalId}` tag or stable SKU/handle match.
4. Enable `SYNC_ENABLE_WRITES=true` for controlled catalog creation/title updates.
5. Separately enable `SYNC_ENABLE_PRICE_WRITES=true` and `SYNC_ENABLE_INVENTORY_WRITES=true` only after reviewing the dry-run diff.
6. Keep `SYNC_APPROVE_BULK_CHANGES=false` until you intentionally approve larger mutation batches.

### Rollback and Recovery

- Disable the workflow or revert the write-enable secrets to `false` to stop further mutations.
- Re-run the workflow in dry-run mode to inspect the next idempotent plan.
- Use `artifacts/shopify-sellvia-sync/details.json` from the last failing run to identify the affected products.
- Correct Sellvia feed data or Shopify product identity tags/SKUs, then rerun.
- Because deletes are not automated, rollback is limited to targeted corrective updates instead of destructive bulk actions.

### API Assumptions and Unresolved Account-Specific Details

- Sellvia product, inventory, price, and order feeds are **account-specific** and must be supplied through environment variables.
- The sync expects each Sellvia record to expose at least one stable identity field: `externalId`/`id`, `sku`, or `handle`.
- Order synchronization is intentionally kept read-only/disabled until the repository has a confirmed Sellvia order schema and the necessary Shopify credentials/scopes.
- If Sellvia exposes a different payload shape, adapt the normalization boundary in `src/shopify-sellvia-sync.js` instead of bypassing the safety checks.

### Monitoring, Alerting, and Audit Logs

- Every run publishes a GitHub job summary with fetched/created/updated/skipped/failed/rate-limited counts.
- On failure, the workflow uploads `summary.json`, `details.json`, and `summary.md` as artifacts.
- When `SYNC_FAILURE_WEBHOOK_URL` is configured, the failure summary is POSTed to that webhook.
- Local dry-run validation can use `SHOPIFY_PRODUCTS_FILE` plus `SELLVIA_*_FILE` inputs to simulate feeds without live credentials.

## API Services

### Shopify Finances Service

Located at `app/services/shopify-finances.server.ts`

**Functions:**
- `getShopifyPayouts(request)` - Fetch payout data and balance
- `formatPayoutRows(payouts)` - Format payouts for display

**Usage:**
```typescript
const payouts = await getShopifyPayouts(request);
console.log(payouts.balance); // { amount: "1000.50", currency: "USD" }
```

### Sellvia Service

Located at `app/services/sellvia.server.ts`

**Functions:**
- `getRevenueMetrics(timeframe)` - Get revenue data
- `getTopProducts(limit)` - Get top performing products
- `getOrderAnalytics(timeframe)` - Get order data
- `getCustomerAnalytics(timeframe)` - Get customer insights
- `getDashboardData()` - Get all analytics data

**Usage:**
```typescript
const data = await getDashboardData();
console.log(data.revenue);  // Monthly revenue
console.log(data.products); // Top 5 products
```

## Dashboard Metrics

### Key Performance Indicators

| Metric | Source | Description |
|--------|--------|-------------|
| Shopify Balance | Shopify Finances API | Pending payout amount |
| Monthly Revenue | Sellvia API | Total revenue for the month |
| Total Orders | Sellvia API | Number of orders placed |
| Avg Order Value | Sellvia API | Average transaction value |
| Unique Visitors | Sellvia API | Number of unique site visitors |
| Conversion Rate | Sellvia API | Percentage of visitors who purchase |
| Top Products | Sellvia API | Best-performing products by revenue |
| Recent Payouts | Shopify Finances API | Last 10 payout transactions |

## Troubleshooting

### Sellvia API Not Responding

1. Verify `SELLVIA_MASTER_KEY` is correct
2. Check network connectivity
3. Review Sellvia API rate limits
4. Check browser console for error messages

### Shopify API Errors

1. Ensure app scopes are correct: `read_orders,write_orders,read_products,read_finances`
2. Verify API credentials are correct
3. Check that development store is active
4. Ensure OAuth redirect URLs are configured

### Database Issues

```bash
# Reset Prisma database
npm run prisma reset

# View database
npm run prisma studio
```

## Deployment

### Deploy to Render

1. Connect your GitHub repository
2. Add environment variables in Render dashboard
3. Deploy using the Dockerfile

See [RENDER_DEPLOY.md](./RENDER_DEPLOY.md) for detailed instructions.

## Available Scripts

```bash
npm run build              # Build for production
npm run dev               # Start development server
npm run start             # Start production server
npm run setup             # Setup database (Prisma)
npm run lint              # Run ESLint
npm run shopify           # Shopify CLI commands
npm run prisma            # Prisma CLI commands
npm run graphql-codegen   # Generate GraphQL types
npm run vite              # Vite CLI commands
npm run sync:shopify-sellvia  # Run the autonomous Shopify + Sellvia sync entry point
```

## Resources

- [Remix Documentation](https://remix.run/docs)
- [Shopify App Development](https://shopify.dev/docs/apps)
- [Shopify Finances API](https://shopify.dev/docs/api/admin-rest/2024-10/resources/payout)
- [Shopify GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Polaris Components](https://polaris.shopify.com/components)

## Support

For issues or questions:

1. Check the [Shopify Dev Docs](https://shopify.dev/docs)
2. Review [GitHub Issues](https://github.com/Jessdanie94/fabulous-gems-dashboard/issues)
3. Contact Shopify Support

## License

This project is part of the Shopify App ecosystem.

---

**App URL:** https://fabulousgemsparlor-store.onrender.com  
**Store:** fabulousgemsparlor.store  
**Last Updated:** 2026-09-10
