#!/usr/bin/env python3
"""Stripe API starter: read-only by default; optional sandbox-only writes.

Install: python -m pip install -r requirements.txt
Then set STRIPE_SECRET_KEY to a Stripe sandbox secret key and run:
    python stripe_demo.py                 # list up to 3 test products
    python stripe_demo.py --write         # create demo objects and a test payment

This demonstration deliberately refuses live keys. Never put keys in this file.
"""

import argparse
import os
import re
import sys
import uuid

try:
    import stripe
except ImportError:
    sys.exit("Stripe SDK is missing. Run: python -m pip install -r requirements.txt")


AMOUNT_CENTS = 2000  # CAD $20.00, in the smallest currency unit (cents)
CURRENCY = "cad"


def require_test_key():
    """Reject missing, publishable, live, and unrecognized credentials."""
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not key.startswith(("sk_test_", "rk_test_")):
        raise ValueError(
            "Set STRIPE_SECRET_KEY to a sandbox secret or restricted key "
            "starting with sk_test_ or rk_test_. Live keys are not allowed."
        )
    return key


def check_connection(client):
    """A bounded, read-only call: list up to three sandbox products."""
    products = client.v1.products.list({"limit": 3})
    print("Connected successfully to Stripe. Test products on this page:", len(products.data))
    for product in products.data:
        print(f"  {product.id}  {product.name}")
    if products.has_more:
        print("  More products exist; this example only shows the first page.")


def create_demo(client, run_id):
    """Create sandbox objects; repeated run IDs reuse operation idempotency keys."""
    def options(stage):
        return {"idempotency_key": f"stripe-api-demo-{run_id}-{stage}"}

    print("Demo run ID:", run_id, flush=True)
    print("Creating sandbox-only objects (no real money moves)...", flush=True)

    customer = client.v1.customers.create(
        {
            "name": "Stripe API demo customer",
            "email": "stripe-demo@example.com",
            "metadata": {"demo": "stripe-api-demo", "run_id": run_id},
        },
        options=options("customer"),
    )
    print("Test customer:", customer.id, flush=True)

    product = client.v1.products.create(
        {
            "name": "Stripe API demo product",
            "description": "Example product created in a Stripe sandbox",
            "metadata": {"demo": "stripe-api-demo", "run_id": run_id},
        },
        options=options("product"),
    )
    print("Test product:", product.id, flush=True)

    price = client.v1.prices.create(
        {
            "product": product.id,
            "unit_amount": AMOUNT_CENTS,
            "currency": CURRENCY,
            "metadata": {"demo": "stripe-api-demo", "run_id": run_id},
        },
        options=options("price"),
    )
    print("Test price:", price.id, "(CAD $20.00)", flush=True)

    # A PaymentIntent is a payment, not an order or shopping cart. Its amount
    # comes from the Price, while metadata records the associated catalog IDs.
    # pm_card_visa is Stripe's simulated success PaymentMethod, not a card number.
    intent = client.v1.payment_intents.create(
        {
            "amount": price.unit_amount,
            "currency": price.currency,
            "customer": customer.id,
            "payment_method_types": ["card"],
            "payment_method": "pm_card_visa",
            "confirm": True,
            "description": "Stripe API demo test payment",
            "metadata": {
                "demo": "stripe-api-demo",
                "run_id": run_id,
                "product_id": product.id,
                "price_id": price.id,
            },
        },
        options=options("payment"),
    )
    print("Test PaymentIntent:", intent.id)
    print("Payment status:", intent.status)
    print("Live mode:", intent.livemode)
    if intent.status == "succeeded":
        print("The simulated payment succeeded. No real charge or transfer occurred.")
        return 0
    print("The simulated payment did not reach succeeded; inspect it in the sandbox.")
    return 2


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--write", action="store_true",
        help="create sandbox customer, product, price and a simulated CAD $20 payment",
    )
    parser.add_argument(
        "--run-id", help="32 lowercase hexadecimal characters from an earlier --write run, for a retry"
    )
    args = parser.parse_args()
    if args.run_id and not args.write:
        parser.error("--run-id can only be used together with --write")
    if args.run_id and not re.fullmatch(r"[0-9a-f]{32}", args.run_id):
        parser.error("--run-id must be exactly 32 lowercase hexadecimal characters")

    try:
        key = require_test_key()
    except ValueError as exc:
        print(f"Safety check: {exc}", file=sys.stderr)
        return 1

    # Automatic retries use the stable idempotency keys supplied below.
    client = stripe.StripeClient(key, max_network_retries=2)
    try:
        check_connection(client)
        if args.write:
            return create_demo(client, args.run_id or uuid.uuid4().hex)
        print("Read-only check complete. Use --write for the optional sandbox demo.")
        return 0
    except stripe.StripeError as exc:
        # Avoid printing response bodies or accidentally echoing a credential.
        message = str(exc).replace(key, "[REDACTED]")
        print(f"Stripe API error ({type(exc).__name__}): {message}", file=sys.stderr)
        print("Check the sandbox key, its permissions, and network connectivity.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
