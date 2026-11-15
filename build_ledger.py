import csv
import json
import re
import sys
from collections import defaultdict
from decimal import Decimal

SRC = "create_ledger.csv.json"
OUT = "2026_cra_ledger.csv"
COLS = ["Date", "Vendor_or_Customer", "Description", "CRA_Category", "CRA_Line",
        "Type", "Gross_Amount", "Tax_GST_HST", "Net_Amount", "Currency",
        "Receipt_or_Proof"]
MONEY = ["Gross_Amount", "Tax_GST_HST", "Net_Amount"]
EXPECT = {"rows": 56, "revenue": Decimal("1232.00"),
          "expenses": Decimal("1012.95"), "profit": Decimal("219.05")}


def money(v):
    return Decimal(str(v)).quantize(Decimal("0.01"))


def main():
    with open(SRC, encoding="utf-8") as f:
        records = json.load(f)

    seen, rows = set(), []
    for rec in records:
        m = re.search(r"WON-[A-Z0-9]+", rec["Description"])
        if m:
            # Expense rows may cite an order ID, and an ID can recur on a later date
            key = (m.group(0), rec["Type"], rec["Date"])
            if key in seen:
                continue
            seen.add(key)
        rows.append(rec)

    rows.sort(key=lambda r: r["Date"])  # stable sort keeps same-day order

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        for r in rows:
            out = {c: r.get(c, "") for c in COLS}
            for c in MONEY:
                out[c] = f"{money(r[c]):.2f}"
            w.writerow(out)

    revenue = sum((money(r["Gross_Amount"]) for r in rows if r["Type"] == "INCOME"), Decimal(0))
    expenses = sum((money(r["Gross_Amount"]) for r in rows if r["Type"] == "EXPENSE"), Decimal(0))
    actual = {"rows": len(rows), "revenue": revenue, "expenses": expenses,
              "profit": revenue - expenses}

    by_line = defaultdict(lambda: [0, Decimal(0), Decimal(0)])
    for r in rows:
        s = by_line[r["CRA_Line"]]
        s[0] += 1
        s[1 if r["Type"] == "INCOME" else 2] += money(r["Gross_Amount"])
    print(f"{'CRA_Line':<16}{'Rows':>5}{'Income':>12}{'Expenses':>12}")
    for line, (n, inc, exp) in sorted(by_line.items()):
        print(f"{line:<16}{n:>5}{inc:>12.2f}{exp:>12.2f}")
    print(f"Rows={actual['rows']} Revenue={revenue:.2f} "
          f"Expenses={expenses:.2f} Profit={actual['profit']:.2f}")

    bad = [k for k in EXPECT if actual[k] != EXPECT[k]]
    if bad:
        for k in bad:
            print(f"MISMATCH {k}: expected {EXPECT[k]}, got {actual[k]}", file=sys.stderr)
        sys.exit(1)
    print("Totals verified.")


if __name__ == "__main__":
    main()
