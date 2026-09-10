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
