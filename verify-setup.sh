#!/bin/bash
# Verify local prerequisites and the Shopify-only dashboard configuration.
set -e

PASSED=0
FAILED=0
WARNING=0
check_pass() { echo "✅ $1"; PASSED=$((PASSED + 1)); }
check_fail() { echo "❌ $1"; FAILED=$((FAILED + 1)); }
check_warn() { echo "⚠️ $1"; WARNING=$((WARNING + 1)); }

echo 'Fabulous Gems Dashboard - setup verification'
for command in node npm git; do
  if command -v "$command" >/dev/null 2>&1; then check_pass "$command installed"; else check_fail "$command missing"; fi
done
if command -v shopify >/dev/null 2>&1; then check_pass 'Shopify CLI installed'; else check_warn 'Shopify CLI not installed'; fi
if [ -d .git ]; then check_pass 'Git repository initialized'; else check_warn 'Git repository not initialized in this directory'; fi
if [ -d node_modules ]; then check_pass 'Dependencies installed'; else check_warn 'Run npm install'; fi
if [ -f .env ]; then
  check_pass '.env file exists'
  for var in SHOPIFY_API_KEY SHOPIFY_API_SECRET SHOPIFY_APP_URL SCOPES SHOPIFY_STORE_DOMAIN SHOPIFY_ADMIN_ACCESS_TOKEN SHOPIFY_WEBHOOK_SECRET; do
    if grep -q "^${var}=." .env; then check_pass "$var configured"; else check_fail "$var missing or empty in .env"; fi
  done
else
  check_fail 'Missing .env: copy .env.example and configure Shopify settings'
fi
for file in package.json app/routes/app._index.tsx app/routes/api.auto-fulfill.tsx app/services/shopify-finances.server.ts app/shopify.server.ts prisma/schema.prisma shopify.app.toml vite.config.ts .github/workflows/ci-cd.yml README.md DEPLOYMENT_CHECKLIST.md GITHUB_ACTIONS_SETUP.md; do
  if [ -f "$file" ]; then check_pass "$file exists"; else check_fail "$file missing"; fi
done
if grep -q '"build":' package.json && grep -q '"test":' package.json; then
  check_pass 'Build and test scripts configured'
else
  check_fail 'Build or test script missing'
fi
echo
echo "Passed: $PASSED  Failed: $FAILED  Warnings: $WARNING"
echo 'Confirm orders/paid is registered to the Render bridge and Sellvia official Shopify app is installed.'
if [ "$FAILED" -eq 0 ]; then exit 0; else exit 1; fi
