# Shopify App Template - Remix

> [!NOTE]
> **Remix is now React Router.** As of [React Router v7](https://remix.run/blog/merging-remix-and-react-router), Remix and React Router have merged.
>
> For new projects, use the **[Shopify App Template - React Router](https://github.com/Shopify/shopify-app-template-react-router)** instead.
>
> To migrate your existing Remix app, follow the **[migration guide](https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix)**.

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using the [Remix](https://remix.run) framework.

Rather than cloning this repo, you can use your preferred package manager and the Shopify CLI with [these steps](https://shopify.dev/docs/apps/getting-started/create).

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-remix) for more details on the Remix app package.

## Quick start

### Prerequisites

Before you begin, you'll need the following:

1. **Node.js**: [Download and install](https://nodejs.org/en/download/) it if you haven't already.
2. **Shopify Partner Account**: [Create an account](https://partners.shopify.com/signup) if you don't have one.
3. **Test Store**: Set up either a [development store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store) or a [Shopify Plus sandbox store](https://help.shopify.com/en/partners/dashboard/managing-stores/plus-sandbox-store) for testing your app.
4. **Shopify CLI**: [Download and install](https://shopify.dev/docs/apps/tools/cli/getting-started) it if you haven't already.

```shell
npm install -g @shopify/cli@latest
```

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-remix
```

### Local Development

```shell
shopify app dev
```

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli).

## Payout Dashboard

This app includes a custom Payout Dashboard that shows:
- **Pending Balance**: Current pending balance from Shopify Payments
- **Last 10 Payouts**: Table of recent payouts with date, amount, and status

The dashboard is implemented in `app/routes/app._index.tsx` using the Shopify Payments GraphQL API.

## Tech Stack

- [Remix](https://remix.run)
- [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix)
- [Shopify App Bridge](https://shopify.dev/docs/apps/tools/app-bridge)
- [Polaris React](https://polaris.shopify.com/)
- [Prisma](https://www.prisma.io/) with SQLite

## Resources

- [Remix Docs](https://remix.run/docs/en/v1)
- [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix)
- [Introduction to Shopify apps](https://shopify.dev/docs/apps/getting-started)
