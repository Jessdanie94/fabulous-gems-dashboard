#!/bin/bash

# 🔍 Fabulous Gems Dashboard - Setup Verification Script
# This script checks if all prerequisites and configurations are properly set up

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNING=0

# Helper functions
print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

check_pass() {
    echo -e "${GREEN}✅ $1${NC}"
    ((PASSED++))
}

check_fail() {
    echo -e "${RED}❌ $1${NC}"
    ((FAILED++))
}

check_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    ((WARNING++))
}

# Start verification
echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║   Fabulous Gems Dashboard - Setup Verification Script        ║
║   This script checks your deployment readiness                ║
╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}\n"

# Phase 1: System Requirements
print_header "Phase 1: System Requirements"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    check_pass "Node.js installed: $NODE_VERSION"
else
    check_fail "Node.js not found. Install from https://nodejs.org/"
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    check_pass "npm installed: $NPM_VERSION"
else
    check_fail "npm not found"
fi

# Check Git
if command -v git &> /dev/null; then
    GIT_VERSION=$(git -v)
    check_pass "Git installed: $GIT_VERSION"
else
    check_fail "Git not found"
fi

# Check Shopify CLI
if command -v shopify &> /dev/null; then
    check_pass "Shopify CLI installed"
else
    check_warn "Shopify CLI not found. Install from https://shopify.dev/docs/apps/tools/cli"
fi

# Phase 2: Repository Setup
print_header "Phase 2: Repository Setup"

if [ -d ".git" ]; then
    check_pass "Git repository initialized"
    
    # Check remote
    if git remote get-url origin &> /dev/null; then
        REMOTE=$(git remote get-url origin)
        check_pass "Git remote configured: $REMOTE"
    else
        check_fail "Git remote not configured"
    fi
else
    check_fail "Git repository not initialized"
fi

# Check package.json
if [ -f "package.json" ]; then
    check_pass "package.json found"
else
    check_fail "package.json not found"
fi

# Phase 3: Environment Variables
print_header "Phase 3: Environment Variables"

if [ -f ".env" ]; then
    check_pass ".env file exists"
    
    # Check for required variables
    ENV_VARS=(
        "SHOPIFY_API_KEY"
        "SHOPIFY_API_SECRET"
        "SHOPIFY_APP_URL"
        "SCOPES"
        "SELLVIA_MASTER_KEY"
    )
    
    for var in "${ENV_VARS[@]}"; do
        if grep -q "^$var=" .env; then
            VALUE=$(grep "^$var=" .env | cut -d'=' -f2)
            if [ -z "$VALUE" ]; then
                check_warn "$var is empty"
            else
                check_pass "$var is configured"
            fi
        else
            check_fail "$var not found in .env"
        fi
    done
else
    check_fail ".env file not found. Copy from .env.example: cp .env.example .env"
fi

# Phase 4: Dependencies
print_header "Phase 4: Dependencies"

if [ -d "node_modules" ]; then
    check_pass "Dependencies installed (node_modules exists)"
else
    check_warn "Dependencies not installed. Run: npm install"
fi

# Check for key dependencies
DEPENDENCIES=(
    "@remix-run/react"
    "@shopify/shopify-app-remix"
    "@prisma/client"
)

for dep in "${DEPENDENCIES[@]}"; do
    if grep -q "\"$dep\"" package.json; then
        check_pass "Package $dep in package.json"
    else
        check_fail "Package $dep not found in package.json"
    fi
done

# Phase 5: Project Structure
print_header "Phase 5: Project Structure"

DIRS=(
    "app/routes"
    "app/services"
    "prisma"
    ".github/workflows"
    "public"
)

for dir in "${DIRS[@]}"; do
    if [ -d "$dir" ]; then
        check_pass "Directory exists: $dir/"
    else
        check_fail "Directory missing: $dir/"
    fi
done

# Phase 6: Key Files
print_header "Phase 6: Key Files"

FILES=(
    "app/routes/app._index.tsx"
    "app/services/shopify-finances.server.ts"
    "app/services/sellvia.server.ts"
    "app/shopify.server.ts"
    ".github/workflows/ci-cd.yml"
    "README.md"
    "DEPLOYMENT_CHECKLIST.md"
    "GITHUB_ACTIONS_SETUP.md"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        check_pass "File exists: $file"
    else
        check_fail "File missing: $file"
    fi
done

# Phase 7: Build & Lint Check
print_header "Phase 7: Build Configuration"

if grep -q "\"build\":" package.json; then
    check_pass "Build script configured"
else
    check_fail "Build script not configured"
fi

if grep -q "\"lint\":" package.json; then
    check_pass "Lint script configured"
else
    check_warn "Lint script not configured"
fi

if grep -q "\"dev\":" package.json; then
    check_pass "Dev script configured"
else
    check_fail "Dev script not configured"
fi

# Phase 8: Database
print_header "Phase 8: Database Configuration"

if [ -f "prisma/schema.prisma" ]; then
    check_pass "Prisma schema found"
else
    check_warn "Prisma schema not found"
fi

if grep -q "DATABASE_URL" .env 2>/dev/null; then
    check_pass "DATABASE_URL configured"
elif grep -q "DATABASE_URL" .env.example 2>/dev/null; then
    check_warn "DATABASE_URL in .env.example but not configured in .env"
else
    check_warn "DATABASE_URL configuration optional for SQLite"
fi

# Phase 9: GitHub Actions
print_header "Phase 9: GitHub Actions"

if [ -f ".github/workflows/ci-cd.yml" ]; then
    check_pass "CI/CD workflow file exists"
    
    if grep -q "Deploy to Render" .github/workflows/ci-cd.yml; then
        check_pass "Deploy step configured"
    else
        check_warn "Deploy step may need configuration"
    fi
else
    check_fail "CI/CD workflow file not found"
fi

# Phase 10: Secrets Check (can't verify values, just existence)
print_header "Phase 10: GitHub Secrets (Local Check)"

echo -e "${YELLOW}ℹ️  To verify GitHub Secrets:${NC}"
echo "   1. Go to: https://github.com/Jessdanie94/fabulous-gems-dashboard/settings/secrets/actions"
echo "   2. Verify these secrets exist:"
echo "      - RENDER_DEPLOY_KEY"
echo "      - RENDER_SERVICE_ID"
echo ""

# Phase 11: API Verification
print_header "Phase 11: API Configuration"

if [ -n "$SHOPIFY_API_KEY" ] || grep -q "SHOPIFY_API_KEY" .env 2>/dev/null; then
    check_pass "Shopify API Key configured"
else
    check_fail "Shopify API Key not configured"
fi

if [ -n "$SELLVIA_MASTER_KEY" ] || grep -q "SELLVIA_MASTER_KEY" .env 2>/dev/null; then
    check_pass "Sellvia Master Key configured"
else
    check_fail "Sellvia Master Key not configured"
fi

if [ -n "$SHOPIFY_APP_URL" ] || grep -q "SHOPIFY_APP_URL" .env 2>/dev/null; then
    check_pass "Shopify App URL configured"
else
    check_fail "Shopify App URL not configured"
fi

# Summary
print_header "Summary"

TOTAL=$((PASSED + FAILED + WARNING))
echo -e "${GREEN}✅ Passed:   $PASSED${NC}"
echo -e "${RED}❌ Failed:   $FAILED${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNING${NC}"
echo -e "\nTotal Checks: $TOTAL"

echo ""

if [ $FAILED -eq 0 ]; then
    if [ $WARNING -eq 0 ]; then
        echo -e "${GREEN}🎉 All checks passed! Your setup is ready for deployment.${NC}\n"
        exit 0
    else
        echo -e "${YELLOW}✅ Setup is ready, but review the warnings above.${NC}\n"
        exit 0
    fi
else
    echo -e "${RED}⚠️  Please fix the failed checks before deploying.${NC}\n"
    exit 1
fi
