# 📋 Deployment Checklist

Complete this checklist to ensure your Fabulous Gems Dashboard is production-ready!

## Phase 1: Prerequisites Setup

### GitHub Setup
- [ ] GitHub repository created: https://github.com/Jessdanie94/fabulous-gems-dashboard
- [ ] Repository is public or private as desired
- [ ] You have admin access to the repository

### Local Environment
- [ ] Node.js v20.19+ installed (`node --version`)
- [ ] npm or pnpm installed (`npm --version`)
- [ ] Git installed and configured (`git config --global user.name`)
- [ ] Shopify CLI installed (`shopify --version`)

## Phase 2: Shopify Setup

### Shopify Partner Account
- [ ] Shopify Partner Account created: https://partners.shopify.com
- [ ] Development store created in Partner Dashboard
- [ ] App created in Partner Dashboard
- [ ] Store URL noted: `fabulousgemsparlor.store`

### Shopify App Configuration
- [ ] API Key obtained from Partner Dashboard
  - Location: Apps and channels → Your app → Configuration
  - Value: `SHOPIFY_API_KEY=`
- [ ] API Secret obtained from Partner Dashboard
  - Value: `SHOPIFY_API_SECRET=`
- [ ] App URL configured: `https://fabulousgemsparlor-store.onrender.com`
- [ ] Redirect URLs configured in Partner Dashboard:
  - [ ] `https://fabulousgemsparlor-store.onrender.com/auth/callback`
  - [ ] `https://fabulousgemsparlor-store.onrender.com/auth/shopify/callback`
- [ ] Scopes configured: `read_orders,write_orders,read_products,read_finances`

### Shopify Store Connection
- [ ] App installed on development store
- [ ] Store permissions granted
- [ ] Access token generated and verified

## Phase 3: Sellvia Setup

### Sellvia Configuration
- [ ] Sellvia account active: https://sellvia.com
- [ ] Master Key obtained from Sellvia dashboard
  - Location: Settings → API → Master Key
  - Value: `SELLVIA_MASTER_KEY=`
- [ ] API access verified (can make test API calls)

## Phase 4: Render Deployment Setup

### Render Account
- [ ] Render account created: https://render.com
- [ ] Account verified (email confirmed)
- [ ] Payment method added (if needed for free tier upgrade)

### Render Service Configuration
- [ ] GitHub repository connected to Render
- [ ] Service created and deployed
- [ ] Service ID obtained
  - Location: Dashboard → Service → URL: `https://dashboard.render.com/services/srv-XXXXXXX`
  - Value: `RENDER_SERVICE_ID=srv-`

### Render Environment Variables
- [ ] Environment variables set in Render dashboard:
  - [ ] `SHOPIFY_API_KEY`
  - [ ] `SHOPIFY_API_SECRET`
  - [ ] `SHOPIFY_APP_URL`
  - [ ] `SCOPES`
  - [ ] `SELLVIA_MASTER_KEY`
- [ ] Database URL configured (if using PostgreSQL)
- [ ] Environment variables match `.env` file

### Render API Key
- [ ] API Key created in Render Account Settings
  - Location: Account → API Tokens
  - Value: `RENDER_DEPLOY_KEY=`
- [ ] API Key has deployment permissions

## Phase 5: GitHub Secrets Configuration

### Add Repository Secrets
1. Go to: Repository → Settings → Secrets and variables → Actions
2. Add the following secrets:

- [ ] `RENDER_DEPLOY_KEY`
  - Value: (your Render API key)
  - Verified: `✓`
  
- [ ] `RENDER_SERVICE_ID`
  - Value: `srv-XXXXXXXXXXXXXXX`
  - Verified: `✓`

- [ ] `SHOPIFY_API_KEY` (optional, for extra security)
  - Value: (your Shopify API key)
  - Verified: `✓`

- [ ] `SHOPIFY_API_SECRET` (optional, for extra security)
  - Value: (your Shopify API secret)
  - Verified: `✓`

- [ ] `SELLVIA_MASTER_KEY` (optional, for extra security)
  - Value: (your Sellvia master key)
  - Verified: `✓`

## Phase 6: Local Development Testing

### Install & Setup
- [ ] Dependencies installed: `npm install`
- [ ] Database initialized: `npm run setup`
- [ ] Environment variables configured in `.env` file
- [ ] All required env vars present:
  - [ ] `SHOPIFY_API_KEY`
  - [ ] `SHOPIFY_API_SECRET`
  - [ ] `SHOPIFY_APP_URL`
  - [ ] `SCOPES`
  - [ ] `SELLVIA_MASTER_KEY`

### Local Testing
- [ ] Linting passes: `npm run lint`
- [ ] App builds successfully: `npm run build`
- [ ] Development server starts: `npm run dev`
- [ ] Dashboard loads in browser: `http://localhost:3000`
- [ ] Shopify authentication works
- [ ] Sellvia data loads on dashboard

### API Verification
- [ ] Shopify Finances API responds correctly
- [ ] Sellvia API responds correctly
- [ ] Dashboard displays real data from both sources

## Phase 7: GitHub Actions Configuration

### Workflow Setup
- [ ] CI/CD workflow file exists: `.github/workflows/ci-cd.yml`
- [ ] Workflow triggers configured (on push to main)
- [ ] Build job configured and tested
- [ ] Test job configured (optional)
- [ ] Deploy job configured with Render integration
- [ ] Health check job configured

### Test Pipeline Run
- [ ] Make a test commit to main branch
- [ ] Push to trigger workflow: `git push origin main`
- [ ] Go to Actions tab and verify:
  - [ ] Build job completed successfully ✅
  - [ ] Test job completed (or skipped if no tests)
  - [ ] Deploy job triggered Render deployment ✅
  - [ ] App deployed successfully in Render dashboard

## Phase 8: Production Verification

### Render Deployment
- [ ] Service deployed successfully
- [ ] All environment variables set in Render
- [ ] App is running and healthy
- [ ] No errors in Render logs

### Live Testing
- [ ] App accessible at: https://fabulousgemsparlor-store.onrender.com
- [ ] Dashboard loads without errors
- [ ] Shopify data displays correctly
- [ ] Sellvia data displays correctly
- [ ] All metrics and charts render properly
- [ ] Payout information updates correctly

### Security Verification
- [ ] No sensitive credentials in code
- [ ] All secrets stored in GitHub Secrets
- [ ] All secrets stored in Render environment variables
- [ ] `.env` file is in `.gitignore`
- [ ] No API keys logged in console output

## Phase 9: Monitoring & Maintenance

### Set Up Alerts
- [ ] Render notifications enabled for failed deployments
- [ ] GitHub notifications enabled for workflow failures
- [ ] Error monitoring configured (optional: Sentry, etc.)

### Regular Checks
- [ ] Schedule weekly manual testing
- [ ] Monitor Render logs for errors
- [ ] Check GitHub Actions workflow history monthly
- [ ] Review API rate limits and usage

## Phase 10: Documentation & Handoff

### Documentation Complete
- [ ] README.md updated with full instructions ✅
- [ ] GITHUB_ACTIONS_SETUP.md created ✅
- [ ] RENDER_DEPLOY.md created ✅
- [ ] Environment variables documented ✅
- [ ] API services documented ✅
- [ ] Troubleshooting guide created ✅

### Team Knowledge Transfer
- [ ] Team members have repository access
- [ ] Team members know how to view logs
- [ ] Team members know how to trigger manual deployments
- [ ] Runbook created for common issues

## 🎉 All Done!

When all items are checked, your deployment is complete!

---

**Last Updated:** 2026-09-10  
**Status:** Ready for Production ✅

### Quick Links
- 📱 App: https://fabulousgemsparlor-store.onrender.com
- 📊 Dashboard: https://fabulousgemsparlor-store.onrender.com/app
- 🔧 GitHub Repo: https://github.com/Jessdanie94/fabulous-gems-dashboard
- 🚀 Render Dashboard: https://dashboard.render.com
- 🛍️ Shopify Partner: https://partners.shopify.com
- 💼 Sellvia: https://sellvia.com
