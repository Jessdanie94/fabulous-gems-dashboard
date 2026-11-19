#!/usr/bin/env python3
"""Read-only-by-default payout monitoring and a guarded legacy CAD audit.

With no arguments, run the original CAD audit (also available as
``--mode legacy-audit``). It requires the old Amount_CAD/Category schema and
fails explicitly if that schema is absent; it does not reinterpret the CRA
ledger as the old schema.

The rolling-3day and friday-sweep modes require ``--environment live`` or
``--environment test``. They only read provider APIs and never initiate a
payout. No .env file is loaded. Test data can never be written to any ledger.
Live ledger writes require ``--write-ledger``, a pre-existing compatible CSV,
and the additional verification described below. A Friday estimate is not a
transfer, a scheduled transaction, bank confirmation, or FX conversion. It is
Stripe available USD minus the USD Sellvia reserve holdback, floored at zero;
Shopify and Sellvia balances are never added to Stripe or to each other.

Stripe: set STRIPE_SECRET_KEY to an sk_live_/rk_live_ or sk_test_/rk_test_
key matching the chosen environment. The returned balance must also identify
its matching livemode. Missing currency/balance entries remain unknown. A
verified USD sweep calculation requires an available USD entry, not a CAD entry.

Shopify: set SHOPIFY_STORE_DOMAIN to the *.myshopify.com domain,
SHOPIFY_ADMIN_ACCESS_TOKEN (or SHOPIFY_API_TOKEN), and SHOPIFY_API_VERSION
(e.g. YYYY-MM). Only the first page (at most 10 payouts) is requested. A paid
status is the provider's status, not confirmation by the receiving bank.
Shopify requests are disabled in test mode because the endpoint does not prove
that the supplied store and token refer to a test environment. To
write those rows, an operator must independently verify that this is the live
store and the reported paid payouts are real, then attest the exact reported
``attestation_digest`` using SHOPIFY_LIVE_ATTESTATION_SHA256,
SHOPIFY_LIVE_ATTESTATION_BY, and SHOPIFY_LIVE_ATTESTATION_AT. The last is an
ISO 8601 timestamp with timezone, at most 24 hours old. First run read-only
to obtain the digest. Any changed payout list requires a new attestation.

Sellvia: SELLVIA_AVAILABLE_USD, SELLVIA_PENDING_USD,
SELLVIA_FULFILLMENT_SUM_USD and SELLVIA_UNFULFILLED_ORDERS are optional
unverified snapshots, never live-verified merely because supplied, and never
usable for a ledger entry. A configured integration may instead provide
SELLVIA_API_KEY (or SELLVIA_MASTER_KEY), SELLVIA_API_BASE_URL, and
SELLVIA_BALANCE_URL on the same HTTPS origin. Its JSON contract must explicitly
include ``livemode`` (boolean), ``currency`` (USD), ``available_commission``,
``pending_commission``, ``fulfillment_sum``, and ``unfulfilled_orders``. This
is an integration contract, not a claim that Sellvia supplies such an API.
For a live ledger entry an operator must independently verify the live account,
endpoint and exact returned figures and attest the reported digest with
SELLVIA_LIVE_ATTESTATION_SHA256, SELLVIA_LIVE_ATTESTATION_BY, and
SELLVIA_LIVE_ATTESTATION_AT (same timestamp rules as Shopify). The digest binds
the displayed values; it is an operator attestation, not a digital signature
or independent proof. A missing, malformed, stale, or mismatched attestation
fails closed. No attestation upgrades an environment snapshot. Sellvia endpoint
requests are disabled in test mode because the endpoint is not independently
verified as a sandbox.

Ledger writes use an advisory POSIX lock and preserve the existing header and
all preceding bytes. Other writers must cooperate with the same file lock.
The supported CRA schema is the eleven named columns below, optionally plus
Status. No ledger is created, and incompatible or malformed CSVs are rejected.
The legacy accounting classification fields are left blank for these
non-accounting informational entries. Holiday calendars, pagination, bank
verification, exchange rates, and independent verification of an operator's
attestation are outside this program's scope.
"""

import argparse
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_LEDGER_PATH = "2026_cra_ledger.csv"
CRA_HEADERS = (
    "Date", "Vendor_or_Customer", "Description", "CRA_Category", "CRA_Line",
    "Type", "Gross_Amount", "Tax_GST_HST", "Net_Amount", "Currency",
    "Receipt_or_Proof",
)
CENT = Decimal("0.01")
ZERO = Decimal("0.00")
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never forward an authorization header, including across same-host redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Redirect refused", headers, fp)


def _safe_https_url(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        return bool(
            parsed.scheme.lower() == "https" and parsed.hostname
            and parsed.username is None and parsed.password is None
            and not parsed.fragment and parsed.port in (None, 443)
            and not any(ord(ch) < 32 for ch in url)
        )
    except (TypeError, ValueError):
        return False


def _bad_json_constant(_value):
    raise ValueError("Non-finite JSON number")


def _http_json(method, url, headers, body, timeout):
    # No URL, exception, response body, authorization header, or secret is logged.
    if not _safe_https_url(url):
        return None
    try:
        request = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirectHandler())
        with opener.open(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            return None
        result = json.loads(raw.decode("utf-8"), parse_float=Decimal, parse_constant=_bad_json_constant)
        return result if isinstance(result, dict) else None
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError,
            UnicodeError, TypeError, OverflowError):
        return None


def http_get_json(url, headers=None, timeout=15):
    """GET HTTPS JSON without proxies or redirects; failures return None."""
    return _http_json("GET", url, headers, None, timeout)


def http_post_json(url, payload, headers=None, timeout=15):
    """POST HTTPS JSON without proxies or redirects; never used to make payouts."""
    try:
        body = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, OverflowError):
        return None
    safe_headers = dict(headers or {})
    safe_headers.setdefault("Content-Type", "application/json")
    return _http_json("POST", url, safe_headers, body, timeout)


def to_decimal(value):
    """Parse an exact USD/CAD-style decimal amount or raise; never default to zero."""
    if value is None or isinstance(value, (bool, float)):
        raise ValueError("Missing or invalid monetary amount")
    try:
        text = str(value).strip()
        if not text or len(text) > 80:
            raise ValueError("Missing or invalid monetary amount")
        amount = Decimal(text)
        if not amount.is_finite() or amount != amount.quantize(CENT):
            raise ValueError("Invalid monetary precision")
        return amount.quantize(CENT)
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Missing or invalid monetary amount") from None


def _nonnegative_decimal(value):
    amount = to_decimal(value)
    if amount < ZERO:
        raise ValueError("Negative amount")
    return amount


def _nonnegative_integer(value):
    if isinstance(value, bool):
        raise ValueError("Invalid count")
    if isinstance(value, int):
        number = value
    elif isinstance(value, str) and re.fullmatch(r"[0-9]{1,18}", value.strip()):
        number = int(value.strip())
    else:
        raise ValueError("Invalid count")
    if number < 0:
        raise ValueError("Invalid count")
    return number


def _amount_text(value):
    return None if value is None else format(value, ".2f")


def _digest(value):
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _attestation_valid(prefix, digest):
    """Check a fresh, explicit operator assertion bound to the exact data digest."""
    if not digest:
        return False
    supplied = os.getenv(prefix + "_LIVE_ATTESTATION_SHA256", "").strip().lower()
    signer = os.getenv(prefix + "_LIVE_ATTESTATION_BY", "").strip()
    timestamp = os.getenv(prefix + "_LIVE_ATTESTATION_AT", "").strip()
    if not re.fullmatch(r"[0-9a-f]{64}", supplied) or supplied != digest:
        return False
    if not signer or len(signer) > 200 or not timestamp:
        return False
    try:
        instant = dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if instant.tzinfo is None or instant.utcoffset() is None:
            return False
        age = dt.datetime.now(dt.timezone.utc) - instant.astimezone(dt.timezone.utc)
        return dt.timedelta(minutes=-5) <= age <= dt.timedelta(hours=24)
    except (ValueError, OverflowError):
        return False


def fetch_stripe_summary(stripe_key, environment=None):
    """Fetch separate USD/CAD available/pending balances; absence is unknown."""
    result = {
        "enabled": bool(stripe_key), "available_usd": None, "pending_usd": None,
        "available_cad": None, "pending_cad": None, "verified": False,
        "environment": environment, "error": None, "missing_balance_entries": [],
    }
    prefixes = {"live": ("sk_live_", "rk_live_"), "test": ("sk_test_", "rk_test_")}
    if environment not in prefixes or not stripe_key or not stripe_key.startswith(prefixes[environment]):
        result["error"] = "Stripe key missing or does not match the explicit environment."
        return result
    data = http_get_json("https://api.stripe.com/v1/balance", headers={"Authorization": "Bearer " + stripe_key})
    if data is None or data.get("livemode") is not (environment == "live"):
        result["error"] = "Stripe request failed or returned an inconsistent environment."
        return result
    try:
        for kind in ("available", "pending"):
            entries = data.get(kind)
            if not isinstance(entries, list):
                raise ValueError("Missing balance list")
            seen = set()
            for entry in entries:
                if not isinstance(entry, dict):
                    raise ValueError("Malformed balance")
                currency = entry.get("currency")
                amount = entry.get("amount")
                if not isinstance(currency, str) or not re.fullmatch(r"[a-zA-Z]{3}", currency):
                    raise ValueError("Malformed currency")
                currency = currency.lower()
                if currency in seen or not isinstance(amount, int) or isinstance(amount, bool):
                    raise ValueError("Malformed balance amount")
                seen.add(currency)
                if currency in ("usd", "cad"):
                    result[kind + "_" + currency] = (Decimal(amount) / Decimal(100)).quantize(CENT)
    except (ValueError, InvalidOperation, OverflowError):
        for field in ("available_usd", "pending_usd", "available_cad", "pending_cad"):
            result[field] = None
        result["error"] = "Stripe balance response is malformed."
        return result
    fields = ("available_usd", "pending_usd", "available_cad", "pending_cad")
    result["missing_balance_entries"] = [field for field in fields if result[field] is None]
    if result["available_usd"] is None:
        result["error"] = "Stripe did not return an available USD balance."
    else:
        result["verified"] = environment == "live"
    return result


def _shopify_domain(value):
    value = (value or "").strip().lower()
    if value.startswith("https://"):
        value = value[8:]
    value = value.rstrip("/")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com", value):
        return None
    return value


def _check_shopify_environment(record, environment):
    """Reject explicit test/live flags that are malformed or conflict with the selection."""
    for field, expected in (("test", environment == "test"), ("livemode", environment == "live")):
        if field in record and (type(record[field]) is not bool or record[field] is not expected):
            raise ValueError("Shopify environment indicator is invalid or inconsistent")


def fetch_shopify_payouts(store_domain, access_token, api_version, environment=None):
    """Read paid Shopify payouts separately; never equate provider paid with bank paid."""
    result = {"paid_payouts": [], "verified": False, "attestation_digest": None, "error": None}
    if environment == "test":
        result["error"] = "Shopify requests are disabled in test mode because the store environment cannot be verified."
        return result
    domain = _shopify_domain(store_domain)
    if (environment not in ("live", "test") or not domain or not access_token
            or not isinstance(api_version, str)
            or not re.fullmatch(r"20[0-9]{2}-(?:01|04|07|10)", api_version)):
        result["error"] = "Shopify configuration or explicit environment is missing or invalid."
        return result
    url = "https://{}/admin/api/{}/shopify_payments/payouts.json?limit=10".format(domain, api_version)
    data = http_get_json(url, headers={"X-Shopify-Access-Token": access_token, "Accept": "application/json"})
    if data is None or not isinstance(data.get("payouts"), list):
        result["error"] = "Shopify payout request failed or returned malformed data."
        return result
    paid = []
    try:
        _check_shopify_environment(data, environment)
        for payout in data["payouts"]:
            if not isinstance(payout, dict) or not isinstance(payout.get("status"), str) or not payout["status"].strip():
                raise ValueError("Invalid payout status")
            if payout["status"].strip().lower() != "paid":
                continue
            payout_id = payout.get("id")
            if isinstance(payout_id, bool) or not re.fullmatch(r"[0-9]{1,30}", str(payout_id)):
                raise ValueError("Invalid payout ID")
            currency = payout.get("currency")
            if not isinstance(currency, str) or not re.fullmatch(r"[A-Za-z]{3}", currency):
                raise ValueError("Invalid payout currency")
            day = payout.get("date")
            if not isinstance(day, str) or dt.date.fromisoformat(day).isoformat() != day:
                raise ValueError("Invalid payout date")
            amount = _nonnegative_decimal(payout.get("amount"))
            _check_shopify_environment(payout, environment)
            paid.append({"id": str(payout_id), "date": day, "amount": _amount_text(amount),
                         "currency": currency.upper(), "provider_status": "paid",
                         "bank_confirmation": "unverified"})
        if len({p["id"] for p in paid}) != len(paid):
            raise ValueError("Duplicate payout ID")
    except (ValueError, TypeError, OverflowError):
        result["error"] = "Shopify paid payout data is malformed or indicates test data."
        return result
    paid.sort(key=lambda item: item["id"])
    digest = _digest({"store_domain": domain, "api_version": api_version, "paid_payouts": paid})
    result["paid_payouts"] = paid
    result["attestation_digest"] = digest
    result["verified"] = environment == "live" and _attestation_valid("SHOPIFY", digest)
    if not result["verified"]:
        result["error"] = "Paid status is not independently attested as live; bank confirmation is unverified."
    return result


def _same_https_origin(base_url, balance_url):
    if not _safe_https_url(base_url) or not _safe_https_url(balance_url):
        return False
    base = urllib.parse.urlsplit(base_url)
    target = urllib.parse.urlsplit(balance_url)
    return base.hostname.lower() == target.hostname.lower() and (base.port or 443) == (target.port or 443)


def fetch_sellvia_balances(api_key, base_url, balance_url="", environment=None):
    """Return USD values separately; environment snapshots are always unverified."""
    result = {
        "source": "env_snapshot", "available_commission_usd": None,
        "pending_commission_usd": None, "fulfillment_sum_usd": None,
        "unfulfilled_orders": None, "verified": False, "attestation_digest": None,
        "error": None,
    }
    mapping = {
        "available_commission_usd": "SELLVIA_AVAILABLE_USD",
        "pending_commission_usd": "SELLVIA_PENDING_USD",
        "fulfillment_sum_usd": "SELLVIA_FULFILLMENT_SUM_USD",
        "unfulfilled_orders": "SELLVIA_UNFULFILLED_ORDERS",
    }
    for field, name in mapping.items():
        raw = os.getenv(name)
        if raw is not None and raw.strip():
            try:
                result[field] = _nonnegative_integer(raw) if field == "unfulfilled_orders" else _nonnegative_decimal(raw)
            except ValueError:
                result["error"] = "One or more Sellvia snapshot values are invalid."
    if environment == "test":
        result["error"] = "Sellvia endpoint requests are disabled in test mode; snapshots remain unverified."
        return result
    if not (api_key and base_url and balance_url and _same_https_origin(base_url, balance_url)
            and environment in ("live", "test")):
        if result["error"] is None:
            result["error"] = "Sellvia snapshots are unverified; a configured verified integration is required."
        return result
    data = http_get_json(balance_url, headers={"Authorization": "Bearer " + api_key, "X-Api-Key": api_key})
    # Never fall back from an unsuccessful API request to a trusted snapshot.
    if data is None:
        result["error"] = "Sellvia API request failed; snapshots remain unverified."
        return result
    try:
        if data.get("livemode") is not (environment == "live") or data.get("currency") != "USD":
            raise ValueError("Environment or currency missing")
        values = {
            "available_commission_usd": _nonnegative_decimal(data.get("available_commission")),
            "pending_commission_usd": _nonnegative_decimal(data.get("pending_commission")),
            "fulfillment_sum_usd": _nonnegative_decimal(data.get("fulfillment_sum")),
            "unfulfilled_orders": _nonnegative_integer(data.get("unfulfilled_orders")),
        }
    except (ValueError, TypeError):
        result["error"] = "Sellvia API response is incomplete, invalid, or inconsistent; snapshots remain unverified."
        return result
    result.update(values)
    result["source"] = "api"
    # Bind to the exact endpoint and values without printing a possibly sensitive URL.
    endpoint_digest = hashlib.sha256(balance_url.encode("utf-8")).hexdigest()
    digest = _digest({
        "endpoint_sha256": endpoint_digest, "environment": environment,
        "available_commission_usd": _amount_text(values["available_commission_usd"]),
        "pending_commission_usd": _amount_text(values["pending_commission_usd"]),
        "fulfillment_sum_usd": _amount_text(values["fulfillment_sum_usd"]),
        "unfulfilled_orders": values["unfulfilled_orders"],
    })
    result["attestation_digest"] = digest
    result["verified"] = environment == "live" and _attestation_valid("SELLVIA", digest)
    result["error"] = None if result["verified"] else "Sellvia API data is not attested as live."
    return result


def _contains_reference(cell, reference):
    return bool(re.search(r"(?<![A-Za-z0-9_-])" + re.escape(reference) + r"(?![A-Za-z0-9_-])", cell))


def append_ledger_entry(ledger_path, date_str, source, category, reference_id,
                        description, amount, currency="USD", status="Calculated"):
    """Append one non-accounting row under an advisory lock; reject incompatible CSVs.

    Returns True if appended, False if that exact reference is already present.
    Raises ValueError/OSError for unsafe or incompatible input without creating a file.
    """
    if not re.fullmatch(r"(?:CIBC-SWEEP-[0-9]{4}-W[0-9]{2}|SHP-PAYOUT-[0-9]{1,30})", reference_id):
        raise ValueError("Invalid ledger reference")
    if dt.date.fromisoformat(date_str).isoformat() != date_str:
        raise ValueError("Invalid ledger date")
    value = _nonnegative_decimal(amount)
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise ValueError("Invalid ledger currency")
    if reference_id.startswith("CIBC-SWEEP-") and (status != "Calculated" or currency != "USD"):
        raise ValueError("Invalid sweep status or currency")
    if reference_id.startswith("SHP-PAYOUT-") and status != "Provider paid; bank unconfirmed":
        raise ValueError("Invalid Shopify status")
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(os.fspath(ledger_path), flags)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("Ledger is not a regular file")
        fcntl.flock(fd, fcntl.LOCK_EX)
        current = os.stat(os.fspath(ledger_path), follow_symlinks=False)
        opened = os.fstat(fd)
        if (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError("Ledger changed while acquiring lock")
        with os.fdopen(fd, "r", encoding="utf-8", newline="", closefd=False) as handle:
            reader = csv.reader(handle, strict=True)
            header = next(reader, None)
            if not header:
                raise ValueError("Ledger header is missing")
            normalized = [cell.strip().lower() for cell in header]
            required = {field.lower() for field in CRA_HEADERS}
            if (len(set(normalized)) != len(normalized)
                    or set(normalized) not in (required, required | {"status"})):
                raise ValueError("Ledger schema is incompatible")
            for existing in reader:
                if not existing:
                    continue
                if len(existing) != len(header):
                    raise ValueError("Malformed ledger row")
                if any(_contains_reference(cell, reference_id) for cell in existing):
                    return False
        is_sweep = reference_id.startswith("CIBC-SWEEP-")
        if is_sweep:
            detail = ("[{}] status=Calculated; Stripe USD estimate, not a transfer; "
                      "bank destination and FX unverified. {}".format(reference_id, description))
            kind = "Non-accounting estimate; status=Calculated"
            proof = "[{}] status=Calculated; no transfer or bank confirmation".format(reference_id)
        else:
            detail = ("[{}] Provider status=paid; bank confirmation unverified. {}".format(reference_id, description))
            kind = "Non-accounting settlement; status=Provider paid"
            proof = "[{}] Provider paid; bank confirmation unverified".format(reference_id)
        row = {
            "date": date_str, "vendor_or_customer": source, "description": detail,
            "cra_category": "", "cra_line": "", "type": kind,
            "gross_amount": "", "tax_gst_hst": "", "net_amount": _amount_text(value),
            "currency": currency, "receipt_or_proof": proof, "status": status,
        }
        buffer = io.StringIO(newline="")
        csv.writer(buffer, lineterminator="\n").writerow([row[name] for name in normalized])
        original_size = os.fstat(fd).st_size
        prefix = b"" if original_size == 0 or os.pread(fd, 1, original_size - 1) in (b"\n", b"\r") else b"\n"
        data = prefix + buffer.getvalue().encode("utf-8")
        os.lseek(fd, 0, os.SEEK_END)
        try:
            written = os.write(fd, data)
            if written != len(data):
                raise OSError("Partial ledger write")
            os.fsync(fd)
        except OSError:
            os.ftruncate(fd, original_size)
            os.fsync(fd)
            raise
        return True
    finally:
        os.close(fd)


def _business_day_cutoff(today, days):
    day = today
    remaining = days
    while remaining:
        day -= dt.timedelta(days=1)
        if day.weekday() < 5:
            remaining -= 1
    return day


def _get_sources(environment):
    return (
        fetch_stripe_summary(os.getenv("STRIPE_SECRET_KEY", ""), environment),
        fetch_shopify_payouts(os.getenv("SHOPIFY_STORE_DOMAIN", ""),
                              os.getenv("SHOPIFY_ADMIN_ACCESS_TOKEN", "") or os.getenv("SHOPIFY_API_TOKEN", ""),
                              os.getenv("SHOPIFY_API_VERSION", ""), environment),
        fetch_sellvia_balances(os.getenv("SELLVIA_API_KEY", "") or os.getenv("SELLVIA_MASTER_KEY", ""),
                               os.getenv("SELLVIA_API_BASE_URL", ""),
                               os.getenv("SELLVIA_BALANCE_URL", ""), environment),
    )


def _serializable_sources(stripe, shopify, sellvia):
    return {
        "stripe": {key: _amount_text(value) if isinstance(value, Decimal) else value for key, value in stripe.items()},
        "shopify": shopify,
        "sellvia_usd": {key: _amount_text(value) if isinstance(value, Decimal) else value for key, value in sellvia.items()},
    }


def run_rolling_3day(args):
    """Report separate sources and optionally log verified live provider-paid payouts."""
    today = dt.date.today()
    cutoff = _business_day_cutoff(today, args.cadence_days)
    stripe, shopify, sellvia = _get_sources(args.environment)
    available = sellvia["available_commission_usd"]
    ready = (available >= args.min_withdrawal_usd
             if sellvia["verified"] and available is not None and args.min_withdrawal_usd is not None
             else None)
    logged = 0
    skipped = 0
    errors = []
    if args.write_ledger and (args.environment != "live" or not shopify["verified"]):
        errors.append("Ledger write refused: Shopify paid payouts are not attested as live.")
    if args.write_ledger and args.environment == "live" and shopify["verified"]:
        for payout in shopify["paid_payouts"]:
            if not (cutoff.isoformat() <= payout["date"] <= today.isoformat()):
                continue
            try:
                added = append_ledger_entry(
                    Path(args.ledger), payout["date"], "Shopify Payments", "", "SHP-PAYOUT-" + payout["id"],
                    "Shopify Payments provider-paid settlement; not evidence of bank receipt.",
                    payout["amount"], payout["currency"], "Provider paid; bank unconfirmed")
                logged += int(added)
                skipped += int(not added)
            except (OSError, ValueError, csv.Error, UnicodeError):
                errors.append("Ledger write refused: missing, inaccessible, malformed, or incompatible ledger.")
                break
    summary = {
        "mode": "rolling-3day", "environment": args.environment, "run_date": today.isoformat(),
        "cohort_window_start": cutoff.isoformat(),
        "cohort_note": "Business days exclude weekends only; holidays are not modeled. First Shopify page only.",
        "sources": _serializable_sources(stripe, shopify, sellvia),
        "min_sellvia_withdrawal_usd": _amount_text(args.min_withdrawal_usd),
        "ready_for_sellvia_withdrawal": ready,
        "new_ledger_rows_logged": logged, "existing_references_skipped": skipped,
        "ledger_write_requested": args.write_ledger, "ledger_errors": errors,
        "notice": "No payout is initiated. Readiness is only against an explicitly supplied threshold, not provider eligibility. "
                  "Shopify provider-paid status is not bank confirmation; no source totals are combined.",
    }
    print(json.dumps(summary, indent=2))
    return summary


def run_friday_sweep(args):
    """Calculate a USD estimate only from verified live Stripe and Sellvia figures."""
    today = dt.date.today()
    stripe, shopify, sellvia = _get_sources(args.environment)
    verified = args.environment == "live" and stripe["verified"] and sellvia["verified"]
    fulfillment = sellvia["fulfillment_sum_usd"] if sellvia["verified"] else None
    holdback = max(ZERO, args.reserve_usd - fulfillment) if fulfillment is not None else None
    estimate = max(ZERO, stripe["available_usd"] - holdback) if verified and holdback is not None else None
    iso_year, iso_week, _ = today.isocalendar()
    reference = "CIBC-SWEEP-{}-W{:02d}".format(iso_year, iso_week)
    ledger_state = "not requested"
    if args.write_ledger:
        if args.environment != "live":
            ledger_state = "refused: test data cannot be written"
        elif not verified or estimate is None:
            ledger_state = "refused: Stripe or Sellvia data is not verified live"
        elif today.weekday() != 4:
            ledger_state = "refused: ledger entry is permitted only on Friday (system local date)"
        else:
            try:
                detail = "Stripe available USD {}; reserve holdback USD {}.".format(
                    _amount_text(stripe["available_usd"]), _amount_text(holdback))
                added = append_ledger_entry(Path(args.ledger), today.isoformat(), "Stripe", "", reference,
                                            detail, estimate, "USD", "Calculated")
                ledger_state = "created" if added else "already exists"
            except (OSError, ValueError, csv.Error, UnicodeError):
                ledger_state = "refused: missing, inaccessible, malformed, or incompatible ledger"
    summary = {
        "mode": "friday-sweep", "environment": args.environment, "run_date": today.isoformat(),
        "sources": _serializable_sources(stripe, shopify, sellvia),
        "fulfillment_reserve_target_usd": _amount_text(args.reserve_usd),
        "verified_sellvia_fulfillment_sum_usd": _amount_text(fulfillment),
        "reserve_holdback_usd": _amount_text(holdback), "calculated_sweep_estimate_usd": _amount_text(estimate),
        "sweep_reference": reference, "ledger_status": "Calculated" if estimate is not None else "unverified",
        "ledger_entry_result": ledger_state, "ledger_entry_created": ledger_state == "created",
        "notice": "Estimate only: no payout or transfer is made or scheduled. CIBC destination and FX are unverified. "
                  "Stripe available USD alone is used; Shopify and Sellvia are separate and never added.",
    }
    print(json.dumps(summary, indent=2))
    return summary


def check_payout_status(ledger_file=DEFAULT_LEDGER_PATH):
    """Safely retain the legacy Amount_CAD/Category audit, without changing data."""
    revenue = ZERO
    expenses = ZERO
    with open(ledger_file, "r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle, strict=True)
        if not reader.fieldnames or not {"Amount_CAD", "Category"}.issubset(reader.fieldnames):
            raise ValueError("Legacy audit requires Amount_CAD and Category columns; this ledger has a different schema.")
        for row in reader:
            if None in row or row.get("Amount_CAD") is None or row.get("Category") is None:
                raise ValueError("Legacy audit encountered a malformed row.")
            category = row["Category"].strip().upper()
            if category in ("REVENUE", "EXPENSE"):
                amount = to_decimal(row["Amount_CAD"])
                if category == "REVENUE":
                    revenue += amount
                else:
                    expenses += amount
    net = revenue - expenses
    print("\n==================================================")
    print("      WONDERFUL GEMS POINT - PAYOUT AUDIT")
    print("==================================================\n")
    print("Total Revenue Logged:                  ${:10.2f} CAD".format(revenue))
    print("Total Expenses Logged:                 ${:10.2f} CAD".format(expenses))
    print("--------------------------------------------------")
    print("Calculated ledger net (not a verified bank balance): ${:.2f} CAD\n".format(net))
    if net > ZERO:
        print("RECOMMENDED 50/30/20 ALLOCATION (informational only)")
        print("Fulfillment Reserve (50%): ${:.2f} CAD".format(net * Decimal("0.50")))
        print("Operating Overhead  (30%): ${:.2f} CAD".format(net * Decimal("0.30")))
        print("Owner Draw         (20%): ${:.2f} CAD".format(net * Decimal("0.20")))


def _arg_amount(value):
    try:
        return _nonnegative_decimal(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a nonnegative monetary value with at most two decimal places") from None


def _positive_days(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be an integer between 1 and 365") from None
    if not 1 <= number <= 365:
        raise argparse.ArgumentTypeError("must be an integer between 1 and 365")
    return number


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Safe payout monitoring; no payout or transfer is performed.")
    parser.add_argument("--mode", choices=("legacy-audit", "rolling-3day", "friday-sweep"), default="legacy-audit")
    parser.add_argument("--environment", choices=("live", "test"), help="Required explicitly for provider modes.")
    parser.add_argument("--ledger", default=DEFAULT_LEDGER_PATH, help="Existing ledger CSV; never created automatically.")
    parser.add_argument("--write-ledger", action="store_true", help="Opt in to verified live informational ledger rows.")
    parser.add_argument("--cadence-days", type=_positive_days, default=3, help="Rolling business days, excluding weekends (default 3).")
    parser.add_argument("--min-withdrawal-usd", type=_arg_amount, default=None,
                        help="User-supplied readiness threshold; provider eligibility is not verified.")
    parser.add_argument("--reserve-usd", type=_arg_amount, default=Decimal("50.00"))
    parser.add_argument("--target-bank", default=None, help="Legacy option; destination is never verified or used for a transfer.")
    args = parser.parse_args(argv)
    if args.mode != "legacy-audit" and args.environment is None:
        parser.error("--environment live or --environment test is required for provider modes")
    if args.mode == "legacy-audit" and args.write_ledger:
        parser.error("the legacy audit is read-only")
    if args.environment == "test" and args.write_ledger:
        parser.error("test data cannot be written to a ledger")
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        if args.mode == "legacy-audit":
            check_payout_status(args.ledger)
        elif args.mode == "rolling-3day":
            summary = run_rolling_3day(args)
            if summary["sources"]["stripe"]["error"] or (args.write_ledger and summary["ledger_errors"]):
                return 1
        else:
            summary = run_friday_sweep(args)
            if summary["sources"]["stripe"]["error"] or (
                args.write_ledger and summary["ledger_entry_result"].startswith("refused:")
            ):
                return 1
    except (OSError, ValueError, csv.Error, UnicodeError):
        # Do not echo paths, credentials, provider responses, or arbitrary exception text.
        if args.mode == "legacy-audit":
            print("Legacy audit refused: the file must exist and have valid Amount_CAD and Category columns.", file=sys.stderr)
        else:
            print("Payout monitor refused invalid or inaccessible data.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
