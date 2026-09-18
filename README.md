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
SCOPES=read_orders,write_orders,read_products,read_finances
SELLVIA_MASTER_KEY=your_sellvia_master_key
```

**Environment Variable Details:**

- `SHOPIFY_API_KEY` - Found in your Shopify Partner dashboard
- `SHOPIFY_API_SECRET` - Found in your Shopify Partner dashboard
- `SHOPIFY_APP_URL` - Your app's deployment URL
- `SCOPES` - Required permissions for the app
  - `read_orders` - View orders
  - `write_orders` - Modify orders
  - `read_products` - View products
  - `read_finances` - Access payout and balance data
- `SELLVIA_MASTER_KEY` - Your Sellvia API master key for analytics

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

## Shopify + Sellvia Sync Automation

This repository now includes an in-repo sync runner at `/home/runner/work/fabulous-gems-dashboard/fabulous-gems-dashboard/src/shopify-sellvia-sync/cli.js` plus the GitHub Actions workflow `/home/runner/work/fabulous-gems-dashboard/fabulous-gems-dashboard/.github/workflows/shopify-sellvia-sync.yml`.

### Architecture and data flow

1. GitHub Actions triggers the sync every 30 minutes or on `workflow_dispatch`.
2. The workflow validates that required secrets exist without printing their values.
3. The sync runner loads Sellvia catalog data from `SELLVIA_CATALOG_ENDPOINT` using `SELLVIA_API_KEY` or `SELLVIA_MASTER_KEY`.
4. The runner fetches Shopify products with the Admin REST API and builds a deterministic index from:
   - `sellvia:id:<externalId>` product tags (preferred)
   - variant SKU fallback when the match is unique
5. Catalog writes create draft Shopify products by default, tagged with `sellvia:managed`, `sellvia:source:catalog`, and `sellvia:id:<externalId>`.
6. Follow-up price and inventory updates are idempotent and only run when a concrete difference is detected.
7. Every run writes a sanitized JSON report, a markdown summary, and a JSONL history entry for troubleshooting.

### Conflict policy

The sync fails closed for ambiguous mappings. A product is skipped and counted as failed when:

- multiple Shopify products share the same `sellvia:id:<externalId>` tag;
- multiple Shopify variants share the same SKU;
- Sellvia id and Shopify SKU resolve to different Shopify products; or
- a matched Shopify product does not have a deterministic variant to update.

No destructive deletes are performed. No existing Shopify products are removed. Order writes remain disabled by default.

### Required secrets and variables

Use GitHub Actions **Secrets** for credentials and **Repository Variables** for write approvals.

#### Required secrets

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN` **or** `SHOPIFY_API_TOKEN`
- `SELLVIA_API_KEY` **or** `SELLVIA_MASTER_KEY`
- `SELLVIA_CATALOG_ENDPOINT`

#### Optional secrets

- `SELLVIA_API_BASE_URL` (defaults to `https://api.sellvia.com`)
- `SELLVIA_ORDER_ENDPOINT` (read-only placeholder until order automation is explicitly supported)
- `SHOPIFY_LOCATION_ID` (otherwise the first active Shopify location is used)
- `SYNC_FAILURE_WEBHOOK_URL` (optional failure notification target)

#### Required repository variables for write-mode promotion

- `SHOPIFY_SELLVIA_WRITE_APPROVED=false` by default

#### Optional repository variables

- `SHOPIFY_SELLVIA_PUBLISH_PRODUCTS=false` keeps created products in `draft`
- `SHOPIFY_SELLVIA_ENABLE_ORDER_SYNC=false` keeps order automation blocked

### Workflow inputs

Manual runs expose:

- `dry_run` — defaults to `true`
- `operation_scope` — one of `all`, `catalog`, `inventory`, `price`, `orders`

Scheduled runs always default to dry-run unless a maintainer both:

1. sets `SHOPIFY_SELLVIA_WRITE_APPROVED=true`, and
2. manually dispatches the workflow with `dry_run=false`.

If `dry_run=false` is requested without that explicit approval variable, the runner automatically enforces dry-run and records the protection in the run summary.

### Exact setup

1. Add the required secrets in **Settings → Secrets and variables → Actions**.
2. Add `SHOPIFY_SELLVIA_WRITE_APPROVED=false` as a repository variable.
3. Confirm that `SELLVIA_CATALOG_ENDPOINT` returns catalog records containing at least:
   - a stable external id (`externalId`, `external_id`, `sellviaId`, or `id`)
   - a product title (`title` or `name`)
   - a SKU when variant-level matching is required
   - optional `price`, `compare_at_price`, `inventory`, `images`, and `tags`
4. Run a manual dry-run and inspect the GitHub step summary plus artifact.
5. Only after reviewing the dry-run report, set `SHOPIFY_SELLVIA_WRITE_APPROVED=true` and manually rerun with `dry_run=false`.

### Local validation

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run sync:shopify-sellvia -- --scope=all --dry-run=true
```

For local dry-run validation without live Sellvia credentials, you can point `SELLVIA_CATALOG_FIXTURE_PATH` at a local JSON fixture file. You can also set `SHOPIFY_PRODUCTS_FIXTURE_PATH` to a local Shopify product fixture for a fully offline dry-run. Both are optional and intended only for safe validation.

### Monitoring, audit, and alerting

- Each run writes a step summary with fetched / created / updated / skipped / failed counts.
- Each run uploads a sanitized artifact containing:
  - `report.json`
  - `summary.md`
  - `history.jsonl`
- Optional failure notification is sent to `SYNC_FAILURE_WEBHOOK_URL` with counts and blockers only. Credentials and customer/order payloads are never logged.

### Retries, rate limits, and timeouts

- API requests use bounded retries with exponential backoff.
- `Retry-After` headers are honored for transient `429` responses.
- Shopify REST call-limit headers trigger a short buffer delay near exhaustion.
- Individual requests time out via `SYNC_REQUEST_TIMEOUT_MS`.
- The overall run is bounded by `SYNC_MAX_RUNTIME_MS` and the workflow job timeout.

### Rollback and recovery

- Leave `SHOPIFY_SELLVIA_WRITE_APPROVED=false` to force dry-run.
- Disable the workflow schedule or cancel queued runs if Sellvia data quality is suspect.
- Re-run a manual dry-run after updating endpoint mappings or credentials.
- Because deletes are disabled and new products default to `draft`, rollback is limited to reviewing and reverting the specific changed Shopify products or prices.

### Known blockers and API assumptions

- Sellvia catalog endpoints are account-specific. The sync intentionally fails closed until `SELLVIA_CATALOG_ENDPOINT` is explicitly configured.
- Order synchronization is not advertised as production-ready here because this repository does not yet contain a verified Sellvia-to-Shopify order contract or safe irreversible-order policy.
- Catalog matching assumes either a stable Sellvia external id or a unique Shopify SKU.
- Inventory synchronization targets one Shopify location per run.

