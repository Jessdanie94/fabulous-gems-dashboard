# Deploying to Render

This guide walks you through deploying your Shopify Payout Dashboard to Render.

## Prerequisites

- Render account (create at https://render.com)
- GitHub repository connected to Render
- Shopify Partner Account with app credentials
- A PostgreSQL database URL

## Step-by-Step Deployment

### 1. Connect Your Repository to Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** and select **"Web Service"**
3. Select **"Deploy an existing repository"** or connect your GitHub account
4. Choose `Jessdanie94/fabulous-gems-dashboard`
5. Fill in the settings:
   - **Name**: `fabulous-gems-dashboard`
   - **Environment**: `Node`
   - **Region**: Choose closest to you
   - **Branch**: `main`
   - **Build Command**: `npm install && npm run build && npm run setup`
   - **Start Command**: `npm run start`

### 2. Set Up PostgreSQL Database

1. In your Render Dashboard, click **"New +"** → **"PostgreSQL"**
2. Configure:
   - **Name**: `fabulous-gems-db`
   - **Database**: `fabulous_gems_db`
   - **User**: Keep default or create custom
   - **Region**: Same as web service
   - **Plan**: Choose appropriate tier (Standard is recommended)

3. Copy the internal connection string (Render provides this automatically)

### 3. Configure Environment Variables

In your web service settings, add the following environment variables:

```
NODE_ENV: production
NODE_VERSION: 22.12.0
DATABASE_URL: (PostgreSQL connection string from Render)
SHOPIFY_API_KEY: your_key_from_shopify_partner
SHOPIFY_API_SECRET: your_secret_from_shopify_partner
SHOPIFY_APP_URL: https://your-service-name.onrender.com
SESSION_SECRET: (generate a secure random string)
SCOPES: write_products,read_orders,write_orders,read_customers,write_customers,read_payments,read_shopify_payments_payouts
```

**⚠️ Important**: Get these values from:
- **Shopify credentials**: Your Shopify Partner Dashboard → App settings
- **SESSION_SECRET**: Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 4. Connect Database to Web Service

1. Go to your web service settings
2. Under **"Environment"**, ensure the `DATABASE_URL` points to your PostgreSQL instance
3. Render will auto-inject this if you use their native database

### 5. Deploy

1. Click **"Create Web Service"**
2. Render automatically deploys from your connected GitHub branch
3. Monitor the **"Logs"** tab for build progress
4. Once deployment completes (green checkmark), your app is live!

## Troubleshooting

### Build Fails with "prisma generate" Error
- This happens if Prisma schema is missing
- Ensure `prisma/schema.prisma` exists in your repo
- Render runs `npm run setup` which includes `prisma generate`

### Database Connection Issues
- Verify `DATABASE_URL` environment variable is set
- Check PostgreSQL is running and accessible
- Run migrations: `npx prisma migrate deploy`

### App Shows Blank Page
- Check logs in Render dashboard
- Verify Shopify credentials are correct
- Ensure SHOPIFY_APP_URL matches your Render service URL

### Port 3000 Issues
- Render automatically assigns port 3000
- Your app should listen on `process.env.PORT || 3000`
- This is already configured in Remix

## Environment Variables Reference

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `NODE_ENV` | Yes | `production` | Set to production for Render |
| `DATABASE_URL` | Yes | `postgresql://...` | From Render PostgreSQL |
| `SHOPIFY_API_KEY` | Yes | `xyz123` | From Shopify Partner Dashboard |
| `SHOPIFY_API_SECRET` | Yes | `secret123` | From Shopify Partner Dashboard |
| `SHOPIFY_APP_URL` | Yes | `https://app.onrender.com` | Your Render service URL |
| `SESSION_SECRET` | Yes | `random_hex_string` | Use `crypto.randomBytes(32)` |
| `SCOPES` | Yes | `read_products,...` | Shopify API scopes needed |

## Auto-Deploy

Once configured, Render automatically redeploys when you push to your main branch.

To disable: Go to service settings → **"Autodeploy"** → toggle off

## Custom Domain

To add a custom domain:
1. Go to your service → **"Settings"**
2. Scroll to **"Custom Domain"**
3. Add your domain and follow DNS setup instructions

## Next Steps

- Monitor app performance in Render dashboard
- Set up error notifications (Render → Settings → Notifications)
- Review Shopify app logs for API errors
- Scale your service if needed (adjust resource plan)

## Support

- Render Docs: https://render.com/docs
- Shopify Remix Docs: https://shopify.dev/docs/api/shopify-app-remix
- GitHub Issues: https://github.com/Jessdanie94/fabulous-gems-dashboard/issues
