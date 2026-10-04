#!/bin/bash

# 🔍 Fabulous Gems Dashboard - API Verification Script
# This script tests connections to Shopify APIs

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
PASSED=0
FAILED=0
WARNING=0

print_header() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }
check_pass() { echo -e "${GREEN}✅ $1${NC}"; ((PASSED++)); }
check_fail() { echo -e "${RED}❌ $1${NC}"; ((FAILED++)); }
check_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; ((WARNING++)); }

if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Please create .env file with required variables"
    exit 1
fi
export $(cat .env | grep -v '#' | xargs)

echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║   Fabulous Gems Dashboard - API Verification Script          ║
║   This script tests your API connections                      ║
╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}\n"

print_header "Phase 1: Environment Variables"
if [ -z "$SHOPIFY_API_KEY" ]; then check_fail "SHOPIFY_API_KEY not set"; else check_pass "SHOPIFY_API_KEY is set"; fi
if [ -z "$SHOPIFY_API_SECRET" ]; then check_fail "SHOPIFY_API_SECRET not set"; else check_pass "SHOPIFY_API_SECRET is set"; fi
if [ -z "$SHOPIFY_APP_URL" ]; then check_fail "SHOPIFY_APP_URL not set"; else check_pass "SHOPIFY_APP_URL is set: $SHOPIFY_APP_URL"; fi

print_header "Phase 2: Network Connectivity"
if ping -c 1 8.8.8.8 &> /dev/null; then check_pass "Internet connection available"; else check_warn "Could not verify internet connection"; fi
if nslookup google.com &> /dev/null; then check_pass "DNS resolution working"; else check_warn "DNS resolution may have issues"; fi

print_header "Phase 3: Shopify API Connectivity"
if [ -z "$SHOPIFY_API_KEY" ] || [ -z "$SHOPIFY_API_SECRET" ]; then
    check_fail "Shopify credentials not configured - skipping API test"
else
    echo "Testing Shopify API connectivity..."
    if curl -s -o /dev/null -w "%{http_code}" https://api.shopify.com &> /dev/null; then
        check_pass "Can connect to Shopify servers"
    else
        check_fail "Cannot connect to Shopify servers - check firewall/network"
    fi
    echo -e "\n${YELLOW}ℹ️  Note:${NC} Full Shopify API test requires authenticated request"
    echo "    This will be tested when you run: npm run dev"
    check_warn "Shopify API authentication test deferred to local dev server"
fi

print_header "Phase 4: Deployment Endpoints"
if [ -n "$SHOPIFY_APP_URL" ]; then
    echo "Testing app URL: $SHOPIFY_APP_URL"
    RENDER_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SHOPIFY_APP_URL" 2>/dev/null || echo "000")
    if [ "$RENDER_RESPONSE" = "000" ]; then
        check_warn "App not accessible at $SHOPIFY_APP_URL (may not be deployed yet)"
    elif [ "$RENDER_RESPONSE" = "200" ] || [ "$RENDER_RESPONSE" = "301" ] || [ "$RENDER_RESPONSE" = "302" ]; then
        check_pass "App endpoint responding (HTTP $RENDER_RESPONSE)"
    else
        check_warn "App endpoint returned HTTP $RENDER_RESPONSE"
    fi
else
    check_fail "SHOPIFY_APP_URL not configured"
fi

print_header "Phase 5: GitHub Connectivity"
if [ -d ".git" ]; then
    REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
    if [ -n "$REMOTE" ]; then
        check_pass "Git remote configured: $REMOTE"
        if git ls-remote origin HEAD &> /dev/null; then check_pass "Can connect to GitHub repository"; else check_warn "Cannot connect to GitHub repository (check credentials/network)"; fi
    else
        check_fail "Git remote not configured"
    fi
else
    check_fail "Not a git repository"
fi

print_header "Phase 6: Local Services"
if [ -d "node_modules" ]; then
    check_pass "npm packages installed"
    if [ -d "node_modules/@shopify" ]; then check_pass "Shopify packages available"; else check_warn "Shopify packages may not be installed correctly"; fi
else
    check_fail "npm packages not installed - run: npm install"
fi
if [ -f "prisma/schema.prisma" ]; then check_pass "Prisma schema found"; else check_warn "Prisma schema not found"; fi

print_header "Phase 7: Configuration Files"
if [ -f "shopify.app.toml" ]; then
    check_pass "shopify.app.toml configured"
    if grep -q "client_id" shopify.app.toml; then check_pass "Shopify client_id configured"; else check_warn "Shopify client_id not found in shopify.app.toml"; fi
else
    check_fail "shopify.app.toml not found"
fi
if [ -f "vite.config.ts" ]; then check_pass "vite.config.ts found"; else check_warn "vite.config.ts not found"; fi

print_header "Summary"
TOTAL=$((PASSED + FAILED + WARNING))
echo -e "${GREEN}✅ Passed:   $PASSED${NC}"
echo -e "${RED}❌ Failed:   $FAILED${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNING${NC}"
echo -e "\nTotal Checks: $TOTAL\n"
print_header "Next Steps"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All critical checks passed!${NC}\n"
    echo "Ready to proceed with:"
    echo "  1. Local development: ${CYAN}npm run dev${NC}"
    echo "  2. Build production:  ${CYAN}npm run build${NC}"
else
    echo -e "${RED}❌ Please fix the failed checks before proceeding${NC}\n"
fi
if [ $WARNING -gt 0 ]; then echo -e "\n${YELLOW}⚠️  Review warnings above${NC}"; fi
echo "For detailed setup instructions, see: DEPLOYMENT_CHECKLIST.md"
echo "For GitHub Actions setup, see: GITHUB_ACTIONS_SETUP.md"
if [ $FAILED -eq 0 ]; then exit 0; else exit 1; fi
