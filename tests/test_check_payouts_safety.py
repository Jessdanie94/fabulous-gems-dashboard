"""Offline safety regression tests for check_payouts.

Run only this suite: python -m unittest discover -s tests -p 'test_check_payouts_safety.py' -v
All balances and credentials below are synthetic. No external network or real
ledger access is required.
"""
import contextlib
import csv
import datetime as dt
from decimal import Decimal
from email.message import Message
import io
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error
import urllib.request
import urllib.response

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import check_payouts as payouts

LEDGER_FIELDS = [
    "Date", "Vendor_or_Customer", "Description", "CRA_Category", "CRA_Line",
    "Type", "Gross_Amount", "Tax_GST_HST", "Net_Amount", "Currency",
    "Receipt_or_Proof",
]


class OfflineCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="payout-safety-")
        self.addCleanup(self.tmp.cleanup)
        self.tempdir = Path(self.tmp.name)
        self.ledger = self.tempdir / "2026_cra_ledger.csv"
        self.original_cwd = os.getcwd()
        os.chdir(self.tempdir)
        self.addCleanup(os.chdir, self.original_cwd)
        # Clear ambient credentials and proxy settings. Even a bug cannot open
        # a real network connection, including to loopback or a configured proxy.
        env = mock.patch.dict(os.environ, {}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        for target in ("socket.socket.connect", "socket.socket.connect_ex", "socket.create_connection"):
            guard = mock.patch(target, side_effect=AssertionError("network disabled in offline payout tests"))
            guard.start()
            self.addCleanup(guard.stop)

        # Deny writes through ordinary file APIs outside the fixture directory,
        # including an accidental attempt to reach the repository's real ledger.
        def check_path(file):
            if isinstance(file, (str, bytes, os.PathLike)):
                target = Path(os.fsdecode(file)).resolve()
                if target != self.tempdir and self.tempdir not in target.parents:
                    raise AssertionError(f"write outside temporary directory: {target}")

        for owner, name in ((__import__("builtins"), "open"), (io, "open")):
            original = getattr(owner, name)

            def guarded_open(file, mode="r", *args, _original=original, **kwargs):
                if any(flag in mode for flag in "wax+"):
                    check_path(file)
                return _original(file, mode, *args, **kwargs)

            guard = mock.patch.object(owner, name, side_effect=guarded_open)
            guard.start()
            self.addCleanup(guard.stop)

        original_os_open = os.open

        def guarded_os_open(file, flags, *args, **kwargs):
            if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
                check_path(file)
            return original_os_open(file, flags, *args, **kwargs)

        guard = mock.patch.object(os, "open", side_effect=guarded_os_open)
        guard.start()
        self.addCleanup(guard.stop)

    def make_ledger(self):
        with self.ledger.open("w", newline="", encoding="utf-8") as stream:
            csv.DictWriter(stream, fieldnames=LEDGER_FIELDS).writeheader()

    def ledger_rows(self):
        with self.ledger.open(newline="", encoding="utf-8") as stream:
            reader = csv.DictReader(stream)
            self.assertEqual(reader.fieldnames, LEDGER_FIELDS)
            rows = list(reader)
        self.assertTrue(all(None not in row and len(row) == 11 for row in rows))
        return rows

    def capture(self, function, *args, **kwargs):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            result = function(*args, **kwargs)
        return result, output.getvalue()


class Friday(dt.date):
    @classmethod
    def today(cls):
        return cls(2026, 11, 20)


class Monday(dt.date):
    @classmethod
    def today(cls):
        return cls(2026, 11, 23)


class NextFriday(dt.date):
    @classmethod
    def today(cls):
        return cls(2026, 11, 27)


class HttpSafetyTests(OfflineCase):
    def test_get_and_post_disable_proxies_and_refuse_redirects(self):
        seen = []
        handlers = []

        class FakeRedirectTransport(urllib.request.BaseHandler):
            # Entirely in-memory: no socket is ever opened.
            handler_order = 100

            def https_open(self, request):
                seen.append((request.get_method(), request.full_url, request.get_header("Authorization")))
                headers = Message()
                headers["Location"] = "https://redirect-destination.invalid/steal"
                response = urllib.response.addinfourl(io.BytesIO(b""), headers, request.full_url, 302)
                response.msg = "Found"
                return response

        original_builder = urllib.request.build_opener

        def build_with_fake_transport(*passed):
            handlers.append(passed)
            return original_builder(*passed, FakeRedirectTransport())

        with mock.patch.dict(os.environ, {"https_proxy": "http://proxy.invalid:9999"}), \
             mock.patch.object(urllib.request, "build_opener", side_effect=build_with_fake_transport):
            get_result = payouts.http_get_json("https://origin.invalid/get", {"Authorization": "Bearer synthetic"})
            post_result = payouts.http_post_json("https://origin.invalid/post", {"x": 1}, {"Authorization": "Bearer synthetic"})

        self.assertIsNone(get_result)
        self.assertIsNone(post_result)
        self.assertEqual([item[0] for item in seen], ["GET", "POST"])
        self.assertEqual([item[1] for item in seen], ["https://origin.invalid/get", "https://origin.invalid/post"])
        self.assertEqual(len(handlers), 2)
        for passed in handlers:
            proxies = [item for item in passed if isinstance(item, urllib.request.ProxyHandler)]
            self.assertEqual(len(proxies), 1)
            self.assertEqual(proxies[0].proxies, {})
            self.assertTrue(any(isinstance(item, payouts.NoRedirectHandler) for item in passed))

    def test_redirect_handler_itself_raises_for_get_and_post(self):
        handler = payouts.NoRedirectHandler()
        for method in ("GET", "POST"):
            with self.subTest(method=method):
                request = urllib.request.Request("https://origin.invalid/", data=b"{}" if method == "POST" else None, method=method)
                with self.assertRaises(urllib.error.HTTPError):
                    handler.redirect_request(request, None, 302, "Found", Message(), "https://other.invalid/")

    def test_get_and_post_parse_a_successful_mock_response(self):
        seen = []

        class FakeSuccessTransport(urllib.request.BaseHandler):
            handler_order = 100

            def https_open(self, request):
                seen.append((request.get_method(), request.data))
                result = urllib.response.addinfourl(io.BytesIO(b'{"ok":true}'), Message(), request.full_url, 200)
                result.msg = "OK"
                return result

        original_builder = urllib.request.build_opener
        with mock.patch.object(urllib.request, "build_opener", side_effect=lambda *h: original_builder(*h, FakeSuccessTransport())):
            self.assertEqual(payouts.http_get_json("https://origin.invalid/get"), {"ok": True})
            self.assertEqual(payouts.http_post_json("https://origin.invalid/post", {"a": 7}), {"ok": True})
        self.assertEqual(seen[0], ("GET", None))
        self.assertEqual(seen[1][0], "POST")
        self.assertEqual(json.loads(seen[1][1]), {"a": 7})


class ProviderSafetyTests(OfflineCase):
    SELLVIA_FIELDS = ("available_commission_usd", "pending_commission_usd", "fulfillment_sum_usd", "unfulfilled_orders")

    def test_missing_sellvia_values_are_unknown_not_fake_defaults(self):
        with mock.patch.object(payouts, "http_get_json") as get:
            result = payouts.fetch_sellvia_balances("", "", environment="live")
        get.assert_not_called()
        self.assertFalse(result["verified"])
        for field in self.SELLVIA_FIELDS:
            self.assertIsNone(result[field], field)

    def test_sellvia_env_snapshots_and_bad_values_remain_unverified(self):
        snapshot = {"SELLVIA_AVAILABLE_USD": "123.45", "SELLVIA_PENDING_USD": "bogus",
                    "SELLVIA_FULFILLMENT_SUM_USD": "12.00", "SELLVIA_UNFULFILLED_ORDERS": "-1",
                    "SELLVIA_LIVE_ATTESTATION_SHA256": "a" * 64,
                    "SELLVIA_LIVE_ATTESTATION_BY": "synthetic operator",
                    "SELLVIA_LIVE_ATTESTATION_AT": dt.datetime.now(dt.timezone.utc).isoformat()}
        with mock.patch.dict(os.environ, snapshot):
            result = payouts.fetch_sellvia_balances("", "", environment="live")
        self.assertFalse(result["verified"])
        self.assertEqual(result["source"], "env_snapshot")
        self.assertEqual(result["available_commission_usd"], Decimal("123.45"))
        self.assertIsNone(result["pending_commission_usd"])
        self.assertEqual(result["fulfillment_sum_usd"], Decimal("12.00"))
        self.assertIsNone(result["unfulfilled_orders"])

    def test_incomplete_sellvia_api_never_promotes_fallback_snapshot(self):
        payload = {"livemode": True, "currency": "USD", "available_commission": "40.00"}
        with mock.patch.dict(os.environ, {"SELLVIA_AVAILABLE_USD": "999.00"}), \
             mock.patch.object(payouts, "http_get_json", return_value=payload):
            result = payouts.fetch_sellvia_balances("synthetic", "https://sellvia.invalid", "https://sellvia.invalid/balance", "live")
        self.assertFalse(result["verified"])
        self.assertIsNone(result["fulfillment_sum_usd"])
        self.assertEqual(result["source"], "env_snapshot")

    def test_stripe_usd_and_cad_available_and_pending_are_separate(self):
        response = {"livemode": True,
                    "available": [{"currency": "usd", "amount": 12345}, {"currency": "cad", "amount": 87654}],
                    "pending": [{"currency": "usd", "amount": 2345}, {"currency": "cad", "amount": 7654}]}
        with mock.patch.object(payouts, "http_get_json", return_value=response):
            stripe = payouts.fetch_stripe_summary("sk_live_synthetic", "live")
        self.assertTrue(stripe["verified"])
        self.assertEqual(stripe["available_usd"], Decimal("123.45"))
        self.assertEqual(stripe["pending_usd"], Decimal("23.45"))
        self.assertEqual(stripe["available_cad"], Decimal("876.54"))
        self.assertEqual(stripe["pending_cad"], Decimal("76.54"))

    def test_missing_currency_is_unknown_and_test_mode_never_verified_live(self):
        missing = {"livemode": True, "available": [{"currency": "usd", "amount": 900}],
                   "pending": [{"currency": "usd", "amount": 100}, {"currency": "cad", "amount": 200}]}
        with mock.patch.object(payouts, "http_get_json", return_value=missing):
            stripe = payouts.fetch_stripe_summary("sk_live_synthetic", "live")
        self.assertTrue(stripe["verified"])
        self.assertIsNone(stripe["available_cad"])
        self.assertIn("available_cad", stripe["missing_balance_entries"])
        no_usd = {"livemode": True, "available": [{"currency": "cad", "amount": 200}],
                  "pending": [{"currency": "cad", "amount": 200}]}
        with mock.patch.object(payouts, "http_get_json", return_value=no_usd):
            stripe = payouts.fetch_stripe_summary("sk_live_synthetic", "live")
        self.assertFalse(stripe["verified"])
        self.assertIsNone(stripe["available_usd"])
        complete_test = {"livemode": False,
                         "available": [{"currency": "usd", "amount": 900}, {"currency": "cad", "amount": 200}],
                         "pending": [{"currency": "usd", "amount": 100}, {"currency": "cad", "amount": 200}]}
        with mock.patch.object(payouts, "http_get_json", return_value=complete_test):
            self.assertFalse(payouts.fetch_stripe_summary("sk_test_synthetic", "test")["verified"])
            self.assertFalse(payouts.fetch_stripe_summary("sk_live_synthetic", "live")["verified"])

    def test_cli_reports_unavailable_stripe_as_failure(self):
        for mode in ("rolling-3day", "friday-sweep"):
            with self.subTest(mode=mode):
                result, output = self.capture(payouts.main, ["--mode", mode, "--environment", "test"])
                self.assertEqual(result, 1)
                self.assertIn("Stripe key missing", output)

    def test_test_mode_does_not_query_unverified_live_shopify_or_sellvia(self):
        with mock.patch.object(payouts, "http_get_json") as get:
            shopify = payouts.fetch_shopify_payouts("example.myshopify.com", "synthetic", "2026-10", "test")
            sellvia = payouts.fetch_sellvia_balances("synthetic", "https://example.invalid", "https://example.invalid/balance", "test")
        get.assert_not_called()
        self.assertFalse(shopify["verified"])
        self.assertFalse(sellvia["verified"])
        self.assertIn("disabled in test mode", shopify["error"])
        self.assertIn("disabled in test mode", sellvia["error"])


class FridaySweepSafetyTests(OfflineCase):
    def args(self, environment="live", write=False):
        argv = ["--mode", "friday-sweep", "--environment", environment, "--ledger", str(self.ledger)]
        if write:
            argv.append("--write-ledger")
        return payouts.parse_args(argv)

    @staticmethod
    def sources(stripe_verified=True, sellvia_verified=True, fulfillment="20.00"):
        stripe = {"verified": stripe_verified, "available_usd": Decimal("100.00"),
                  "available_cad": Decimal("8000.00"), "pending_usd": Decimal("2.00"), "pending_cad": Decimal("3.00")}
        shopify = {"verified": True, "paid_payouts": [{"amount": "9999.00", "currency": "USD"}]}
        sellvia = {"verified": sellvia_verified, "available_commission_usd": Decimal("7777.00"),
                   "pending_commission_usd": Decimal("8888.00"), "fulfillment_sum_usd": Decimal(fulfillment)}
        return stripe, shopify, sellvia

    def test_default_fifty_dollar_reserve_and_no_addition_of_other_balances(self):
        args = self.args()
        self.assertEqual(args.reserve_usd, Decimal("50.00"))
        for fulfillment, expected_holdback, expected_estimate in (("0.00", "50.00", "50.00"),
                                                                 ("20.00", "30.00", "70.00"),
                                                                 ("50.00", "0.00", "100.00"),
                                                                 ("120.00", "0.00", "100.00")):
            with self.subTest(fulfillment=fulfillment), \
                 mock.patch.object(payouts, "_get_sources", return_value=self.sources(fulfillment=fulfillment)), \
                 mock.patch.object(payouts.dt, "date", Friday):
                summary, _ = self.capture(payouts.run_friday_sweep, args)
                self.assertEqual(summary["fulfillment_reserve_target_usd"], "50.00")
                self.assertEqual(summary["reserve_holdback_usd"], expected_holdback)
                self.assertEqual(summary["calculated_sweep_estimate_usd"], expected_estimate)
                self.assertEqual(summary["sources"]["stripe"]["available_usd"], "100.00")
                self.assertEqual(summary["sources"]["stripe"]["available_cad"], "8000.00")

    def test_either_unverified_source_blocks_estimate_and_ledger(self):
        self.make_ledger()
        original = self.ledger.read_bytes()
        for stripe_ok, sellvia_ok in ((False, True), (True, False), (False, False)):
            with self.subTest(stripe_verified=stripe_ok, sellvia_verified=sellvia_ok), \
                 mock.patch.object(payouts, "_get_sources", return_value=self.sources(stripe_ok, sellvia_ok)), \
                 mock.patch.object(payouts.dt, "date", Friday), \
                 mock.patch.object(payouts, "append_ledger_entry") as append:
                summary, _ = self.capture(payouts.run_friday_sweep, self.args(write=True))
                append.assert_not_called()
                self.assertIsNone(summary["calculated_sweep_estimate_usd"])
                self.assertFalse(summary["ledger_entry_created"])
                self.assertEqual(self.ledger.read_bytes(), original)

    def test_test_mode_is_rejected_and_cannot_append_even_if_called_directly(self):
        self.make_ledger()
        original = self.ledger.read_bytes()
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            self.args(environment="test", write=True)
        # Defense in depth: simulate a caller bypassing the CLI validator.
        args = self.args(environment="test")
        args.write_ledger = True
        with mock.patch.object(payouts, "_get_sources", return_value=self.sources()), \
             mock.patch.object(payouts.dt, "date", Friday), \
             mock.patch.object(payouts, "append_ledger_entry") as append:
            summary, _ = self.capture(payouts.run_friday_sweep, args)
        append.assert_not_called()
        self.assertFalse(summary["ledger_entry_created"])
        self.assertIsNone(summary["calculated_sweep_estimate_usd"])
        self.assertEqual(self.ledger.read_bytes(), original)

    def test_real_provider_path_for_synthetic_stripe_test_data_cannot_write(self):
        self.make_ledger()
        original = self.ledger.read_bytes()
        test_balance = {"livemode": False,
                        "available": [{"currency": "usd", "amount": 10000}, {"currency": "cad", "amount": 20000}],
                        "pending": [{"currency": "usd", "amount": 0}, {"currency": "cad", "amount": 0}]}
        args = self.args(environment="test")
        args.write_ledger = True  # A malicious caller bypasses parse_args.
        with mock.patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test_synthetic"}), \
             mock.patch.object(payouts, "http_get_json", return_value=test_balance), \
             mock.patch.object(payouts.dt, "date", Friday), \
             mock.patch.object(payouts, "append_ledger_entry") as append:
            summary, _ = self.capture(payouts.run_friday_sweep, args)
        append.assert_not_called()
        self.assertFalse(summary["sources"]["stripe"]["verified"])
        self.assertFalse(summary["ledger_entry_created"])
        self.assertIsNone(summary["calculated_sweep_estimate_usd"])
        self.assertEqual(self.ledger.read_bytes(), original)

    def test_only_friday_logs_and_a_later_week_gets_a_distinct_reference(self):
        self.make_ledger()
        args = self.args(write=True)
        with mock.patch.object(payouts, "_get_sources", return_value=self.sources()):
            with mock.patch.object(payouts.dt, "date", Friday):
                first, _ = self.capture(payouts.run_friday_sweep, args)
            after_first = self.ledger.read_bytes()
            with mock.patch.object(payouts.dt, "date", Monday):
                monday, _ = self.capture(payouts.run_friday_sweep, args)
            self.assertFalse(monday["ledger_entry_created"])
            self.assertEqual(self.ledger.read_bytes(), after_first)
            with mock.patch.object(payouts.dt, "date", NextFriday):
                next_week, _ = self.capture(payouts.run_friday_sweep, args)
        self.assertEqual(first["sweep_reference"], "CIBC-SWEEP-2026-W47")
        self.assertEqual(next_week["sweep_reference"], "CIBC-SWEEP-2026-W48")
        self.assertTrue(next_week["ledger_entry_created"])
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 2)
        for expected in ("CIBC-SWEEP-2026-W47", "CIBC-SWEEP-2026-W48"):
            self.assertEqual(sum(expected in " ".join(row.values()) for row in rows), 1)

    def test_live_synthetic_end_to_end_idempotent_and_preserves_cra_schema(self):
        self.make_ledger()
        with self.ledger.open("a", newline="", encoding="utf-8") as stream:
            csv.writer(stream).writerow(["2026-11-01", "Prior", "Previous entry", "", "", "", "", "", "", "CAD", ""])
        original = self.ledger.read_bytes()
        stripe_data = {"livemode": True,
                       "available": [{"currency": "usd", "amount": 10012}, {"currency": "cad", "amount": 800000}],
                       "pending": [{"currency": "usd", "amount": 200}, {"currency": "cad", "amount": 300}]}
        sellvia_data = {"livemode": True, "currency": "USD", "available_commission": "7777.00",
                        "pending_commission": "8888.00", "fulfillment_sum": "20.00", "unfulfilled_orders": 2}
        shopify_data = {"payouts": [{"id": 42, "date": "2026-11-20", "amount": "9999.00", "currency": "USD", "status": "paid"}]}

        def fake_provider(url, headers=None, timeout=15):
            if url == "https://api.stripe.com/v1/balance":
                return stripe_data
            if url == "https://sellvia.invalid/balance":
                return sellvia_data
            if url.startswith("https://synthetic.myshopify.com/"):
                return shopify_data
            self.fail("unexpected provider URL: " + url)

        config = {"STRIPE_SECRET_KEY": "sk_live_synthetic", "SELLVIA_API_KEY": "synthetic",
                  "SELLVIA_API_BASE_URL": "https://sellvia.invalid", "SELLVIA_BALANCE_URL": "https://sellvia.invalid/balance",
                  "SHOPIFY_STORE_DOMAIN": "synthetic.myshopify.com", "SHOPIFY_ADMIN_ACCESS_TOKEN": "synthetic",
                  "SHOPIFY_API_VERSION": "2026-10"}
        with mock.patch.dict(os.environ, config), mock.patch.object(payouts, "http_get_json", side_effect=fake_provider):
            # This is an explicitly synthetic operator attestation of synthetic API data.
            preliminary = payouts.fetch_sellvia_balances("synthetic", config["SELLVIA_API_BASE_URL"], config["SELLVIA_BALANCE_URL"], "live")
            self.assertFalse(preliminary["verified"])
            self.assertTrue(preliminary["attestation_digest"])
            attest = {"SELLVIA_LIVE_ATTESTATION_SHA256": preliminary["attestation_digest"],
                      "SELLVIA_LIVE_ATTESTATION_BY": "synthetic operator",
                      "SELLVIA_LIVE_ATTESTATION_AT": dt.datetime.now(dt.timezone.utc).isoformat()}
            with mock.patch.dict(os.environ, attest), mock.patch.object(payouts.dt, "date", Friday):
                first, _ = self.capture(payouts.run_friday_sweep, self.args(write=True))
                second, _ = self.capture(payouts.run_friday_sweep, self.args(write=True))

        self.assertEqual(first["calculated_sweep_estimate_usd"], "70.12")
        self.assertEqual(first["sources"]["stripe"]["available_usd"], "100.12")
        self.assertEqual(first["sources"]["stripe"]["available_cad"], "8000.00")
        self.assertEqual(first["sources"]["shopify"]["paid_payouts"][0]["amount"], "9999.00")
        self.assertEqual(first["sources"]["sellvia_usd"]["available_commission_usd"], "7777.00")
        self.assertEqual(first["ledger_status"], "Calculated")
        self.assertTrue(first["ledger_entry_created"])
        self.assertFalse(second["ledger_entry_created"])
        self.assertEqual(second["ledger_entry_result"], "already exists")
        reference = "CIBC-SWEEP-2026-W47"
        self.assertEqual(first["sweep_reference"], reference)
        self.assertEqual(second["sweep_reference"], reference)
        self.assertTrue(self.ledger.read_bytes().startswith(original))
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 2)
        sweep_rows = [row for row in rows if reference in " ".join(row.values())]
        self.assertEqual(len(sweep_rows), 1)
        row = sweep_rows[0]
        self.assertIn("Calculated", " ".join(row.values()))
        self.assertEqual(row["Net_Amount"], "70.12")
        self.assertEqual(row["Currency"], "USD")
        self.assertNotIn("scheduled", " ".join(row.values()).lower())
        self.assertNotIn("completed", " ".join(row.values()).lower())
        self.assertEqual(row["CRA_Category"], "")
        self.assertEqual(row["CRA_Line"], "")


if __name__ == "__main__":
    unittest.main()
