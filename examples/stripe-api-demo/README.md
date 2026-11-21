# Stripe API demo

This Python example checks your Stripe connection and demonstrates common API operations. It refuses all live keys. By default, it only lists up to three products in your sandbox. The optional `--write` command creates simulated objects and a simulated CAD $20.00 payment; **no real money moves**. It does not collect or contain a real card number.

## 1. Install

Use Python 3.9 or later. In a terminal opened in this folder, run:

```bash
python3 -m pip install -r requirements.txt
```

The requirements file pins the SDK version used to test this demo. Keep dependencies updated when building a real application.

## 2. Select a sandbox key

In the [Stripe Dashboard](https://dashboard.stripe.com/), use the account picker to select your sandbox, then open its Developers / API keys page. Copy that sandbox's **secret** key (`sk_test_...`), or a restricted sandbox key (`rk_test_...`) with permissions to read products and, for `--write`, create customers, products, prices, and PaymentIntents. Stripe recommends a separate general sandbox for new integrations.

Never paste a secret key into this file, a repository, a public chat, or browser-side code. Use a secrets manager for deployed applications. For a temporary local terminal session on macOS or Linux, you can enter it without displaying it or putting it in shell history:

```bash
read -r -s -p 'Sandbox Stripe secret key: ' STRIPE_SECRET_KEY; echo
export STRIPE_SECRET_KEY
```

On Windows PowerShell:

```powershell
$secureKey = Read-Host 'Sandbox Stripe secret key' -AsSecureString
$env:STRIPE_SECRET_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
```

The key remains in that terminal's environment until you close the session or unset it. In Bash, use `unset STRIPE_SECRET_KEY`; in PowerShell, use `Remove-Item Env:STRIPE_SECRET_KEY`. Do not share the key with anyone. A publishable key (`pk_...`) cannot be used for these server-side API calls.

## 3. Test the connection

```bash
python3 stripe_demo.py
```

This sends one read-only request to list up to three sandbox products. A successful response proves that the key can authenticate **and has permission to list products**. An empty product list is fine. If a restricted key lacks product-read permission, Stripe may return a permission error even if the key is otherwise valid. The check does not create or alter Stripe data.

## 4. Run the optional sandbox demo

```bash
python3 stripe_demo.py --write
```

The script creates one sandbox Customer, Product and Price, then creates and confirms a CAD $20.00 PaymentIntent with Stripe's `pm_card_visa` test payment method. The product and price IDs are stored in payment metadata for illustration; a PaymentIntent is not itself a shopping cart or order. A successful payment can also produce a test Charge. The returned payment status is printed; a result other than `succeeded` is not reported as success. The script does not print a PaymentIntent client secret.

The new objects remain in your sandbox and are visible in the Dashboard. Each new run generates a fresh run ID and generally creates another set of objects. To retry the *same* run after an interruption, use its printed ID:

```bash
python3 stripe_demo.py --write --run-id PUT_THE_32_CHARACTER_RUN_ID_HERE
```

Each creation has a stable, operation-specific idempotency key, so Stripe can return the original response instead of duplicating the same request. Retry with identical parameters. Stripe may prune idempotency keys after they are at least 24 hours old, so an old retry can create new objects. Keep track of created IDs when building a real integration. Do not use the Dashboard's bulk test-data deletion for cleanup unless you deliberately intend to delete *all* relevant sandbox data.

## Durable webhook queue and order mapping

The separately configured [PostgreSQL/Prisma queue](./durable-queue/README.md) provides an event inbox, order-to-PaymentIntent mappings, leases, and reconciliation records. It does not install a webhook route, start a worker, or fulfill an order automatically. Read its security and integration requirements before using it.

## What else can Stripe do?

- **Payments and checkout:** accept payments through hosted Checkout, payment links, or custom integrations using PaymentIntents and Stripe's payment UI.
- **Customers and catalog:** maintain customer records, products, prices, and payment methods.
- **Billing:** manage subscriptions, invoices, recurring payments, and billing events.
- **Operations:** issue refunds, inspect balances and payouts, and handle disputes; actual availability depends on account permissions and product support.
- **Automation:** receive signed webhooks when events such as payment completion or invoice status changes occur. Verify signatures and make handlers idempotent.
- **Platforms:** Stripe Connect supports qualifying marketplaces and platforms working with connected accounts.

For production, use a proper checkout integration, keep secret keys server-side, verify webhook signatures, handle payment statuses and customer authentication, use idempotency keys tied to your own order IDs, and never log client secrets or place personal information or card data in metadata. Review Stripe's security guidance before accepting real payments. This demo is educational, not production-ready.

## Official references

- [Stripe API reference](https://docs.stripe.com/api)
- [Testing and sandbox environments](https://docs.stripe.com/testing-use-cases)
- [Stripe Python SDK](https://github.com/stripe/stripe-python)
- [PaymentIntents guide](https://docs.stripe.com/payments/payment-intents)
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Webhook signature verification](https://docs.stripe.com/webhooks/signature)
