"""Summarize the CRA ledger by type and CRA line."""
import csv
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tax_logger import LEDGER_PATH  # noqa: E402


def main():
    if not os.path.exists(LEDGER_PATH):
        print("No ledger found.")
        return
    totals = defaultdict(float)
    by_line = defaultdict(float)
    with open(LEDGER_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            amt = float(row["amount"])
            totals[row["type"]] += amt
            by_line[(row["type"], row["cra_line"])] += amt

    for (t, line), amt in sorted(by_line.items()):
        print(f"{t:<8} {line:<12} {amt:>12,.2f}")
    revenue, expense = totals["REVENUE"], totals["EXPENSE"]
    print("-" * 34)
    print(f"Revenue  {revenue:>25,.2f}")
    print(f"Expenses {expense:>25,.2f}")
    print(f"Net      {revenue - expense:>25,.2f}")


if __name__ == "__main__":
    main()
