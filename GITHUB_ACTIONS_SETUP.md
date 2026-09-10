# GitHub Actions CI/CD Setup Guide

Your Fabulous Gems Dashboard now has an automated CI/CD pipeline! Here's how to complete the setup.

## 🤖 What the Pipeline Does

Every time you push to `main`:
1. ✅ Lints your code (ESLint)
2. ✅ Builds your app
3. ✅ Runs tests
4. ✅ Deploys to Render automatically
5. ✅ Verifies app health

## 📋 Prerequisites

Before enabling auto-deployment, you need:

1. **Render Account** - [Create here](https://render.com)
2. **Render API Key** - For authorization
3. **Render Service ID** - Your app's service identifier

## 🔧 Setup Steps

### Step 1: Get Your Render Service ID

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click on your **Fabulous Gems Dashboard** service
3. Copy the **Service ID** from the URL: `https://dashboard.render.com/services/srv-XXXXXXXXXXXXXXX`
   - It's the part that starts with `srv-`

### Step 2: Create Render API Key

1. Go to [Render Account Settings](https://dashboard.render.com/account/api-tokens)
2. Click **Create API Key**
3. Name it: `GitHub Actions`
4. Copy the API key (you'll use it in Step 3)

### Step 3: Add GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add:

**Secret 1: RENDER_DEPLOY_KEY**
- Name: `RENDER_DEPLOY_KEY`
- Value: (paste your Render API key from Step 2)

**Secret 2: RENDER_SERVICE_ID**
- Name: `RENDER_SERVICE_ID`
- Value: `srv-XXXXXXXXXXXXXXX` (your service ID from Step 1)

### Step 4: Verify Setup

1. Go to your repository
2. Click **Actions** tab
3. You should see the **CI/CD Pipeline** workflow
4. Make a small change and commit to `main`
5. Watch the pipeline run automatically! 🚀

## 📊 Viewing Pipeline Status

### In GitHub
- **Actions Tab** - View all workflow runs
- **Green checkmark** - Deployment successful ✅
- **Red X** - Deployment failed ❌

### In Render
- **Dashboard** - Live logs of deployment
- **Events** - Recent deployments and status changes

## 🔍 Troubleshooting

### Pipeline Shows "Skipped" for Deploy

**Cause:** GitHub secrets not configured

**Fix:**
1. Follow **Step 3** above to add secrets
2. Push a new commit to trigger the pipeline

### Deploy Job Fails

**Check:**
1. Verify `RENDER_DEPLOY_KEY` is correct
2. Verify `RENDER_SERVICE_ID` is correct
3. Check Render dashboard for deployment errors

### Health Check Returns Error

**This is normal** - App may take 30-60 seconds to restart after deployment. Check Render dashboard for actual status.

## 📝 Pipeline Stages Explained

### Stage 1: Build
- Installs dependencies
- Runs linter
- Builds production bundle

### Stage 2: Test
- Sets up database
- Runs test suite (if configured)

### Stage 3: Deploy
- Triggers Render deployment
- Waits for app to stabilize
- Performs health check

### Stage 4: Notify
- Reports final status
- Provides app URL and next steps

## 🚀 How to Deploy Now

Any of these actions trigger automatic deployment:

1. **Push to main branch**
   ```bash
   git push origin main
   ```

2. **Merge a pull request**
   - Create PR → Review → Merge

3. **Direct commit**
   ```bash
   git commit -am "Update dashboard" && git push
   ```

## ⚙️ Customizing the Pipeline

### Add Environment Variables

Edit `.github/workflows/ci-cd.yml` and add to the `deploy` job:

```yaml
env:
  SHOPIFY_API_KEY: ${{ secrets.SHOPIFY_API_KEY }}
  SHOPIFY_API_SECRET: ${{ secrets.SHOPIFY_API_SECRET }}
  SELLVIA_MASTER_KEY: ${{ secrets.SELLVIA_MASTER_KEY }}
```

Then add these secrets in GitHub (same as Step 3).

### Disable Auto-Deploy

Comment out or remove the `deploy` job in `.github/workflows/ci-cd.yml`

### Add Custom Tests

Replace this line in `.github/workflows/ci-cd.yml`:
```yaml
run: npm run test 2>/dev/null || echo "No tests configured"
```

With:
```yaml
run: npm run test
```

And add a `test` script to `package.json`:
```json
"test": "vitest run"
```

## 📚 Resources

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Render Deployments](https://render.com/docs/deploys)
- [Render API Reference](https://api-docs.render.com/)

## ✅ Quick Checklist

- [ ] Copied Service ID from Render
- [ ] Created API Key in Render
- [ ] Added `RENDER_DEPLOY_KEY` secret to GitHub
- [ ] Added `RENDER_SERVICE_ID` secret to GitHub
- [ ] Pushed a commit to test the pipeline
- [ ] Verified deployment in Render dashboard
- [ ] App is live at https://fabulousgemsparlor-store.onrender.com

## 🎉 You're All Set!

Your app now deploys automatically on every push to `main`. No manual work needed!

**Questions?** Check the [Actions tab](https://github.com/Jessdanie94/fabulous-gems-dashboard/actions) to see detailed logs of any run.

---

Happy deploying! 🚀💎
