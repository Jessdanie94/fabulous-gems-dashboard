"""Append CRA-relevant revenue/expense transactions to a CSV ledger."""
import csv
import os
from datetime import datetime, timezone

LEDGER_PATH = os.environ.get(
    "CRA_LEDGER_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "cra_ledger.csv"),
)
FIELDS = ["timestamp", "type", "description", "amount", "source", "cra_line"]
VALID_TYPES = {"REVENUE", "EXPENSE"}


def log_cra_transaction(tx_type, description, amount, source, cra_line):
    tx_type = tx_type.upper()
    if tx_type not in VALID_TYPES:
        raise ValueError(f"type must be one of {sorted(VALID_TYPES)}")
    amount = round(float(amount), 2)
    if amount < 0:
        raise ValueError("amount must be non-negative")

    os.makedirs(os.path.dirname(LEDGER_PATH), exist_ok=True)
    is_new = not os.path.exists(LEDGER_PATH)
    row = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "type": tx_type,
        "description": description,
        "amount": f"{amount:.2f}",
        "source": source,
        "cra_line": cra_line,
    }
    with open(LEDGER_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if is_new:
            writer.writeheader()
        writer.writerow(row)
    print(f"Logged {tx_type} {amount:.2f} ({cra_line}): {description}")
    return row
