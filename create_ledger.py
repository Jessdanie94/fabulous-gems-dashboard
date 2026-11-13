import csv
from collections import defaultdict

LEDGER_FILE = "2026_cra_ledger.csv"
SUMMARY_FILE = "2026_cra_summary.csv"
HEADERS = ["Date", "Category", "Description", "Amount_CAD", "Vendor", "CRA_Line"]

TRANSACTIONS = [
    # CRA Audit Note: Per owner statement, the two lump-sum entries below ($455.05 and $121.50) have individual order IDs backed by the master Shopify Orders CSV export.
    {"Date": "2026-11-01 10:15:00", "Category": "REVENUE", "Description": "Sellvia Customer Order Revenue", "Amount_CAD": 455.05, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-01 12:00:00", "Category": "REVENUE", "Description": "Historical Store Sales Adjustment", "Amount_CAD": 121.50, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-06 17:32:00", "Category": "EXPENSE", "Description": "Sellvia Wholesale Order Fulfillment", "Amount_CAD": 30.45, "Vendor": "Sellvia", "CRA_Line": "Line 8810"},
    {"Date": "2026-11-06 23:07:00", "Category": "EXPENSE", "Description": "Sellvia Wholesale Order Fulfillment", "Amount_CAD": 19.28, "Vendor": "Sellvia", "CRA_Line": "Line 8810"},
    {"Date": "2026-11-07 03:45:00", "Category": "REVENUE", "Description": "Order Nov 7 Store Sale", "Amount_CAD": 19.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-07 05:30:46", "Category": "REVENUE", "Description": "Order WON-WTTW2E1XQ380", "Amount_CAD": 20.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-07 06:00:37", "Category": "REVENUE", "Description": "Order WON-0CB7057E4Z62", "Amount_CAD": 20.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-07 12:10:00", "Category": "EXPENSE", "Description": "Shopify Bill #A610817303 (POS Pro & Apps)", "Amount_CAD": 133.09, "Vendor": "Shopify", "CRA_Line": "Line 8810"},
    {"Date": "2026-11-07 15:30:15", "Category": "REVENUE", "Description": "Order WON-Q1L7VJN7T820", "Amount_CAD": 12.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-08 03:46:00", "Category": "REVENUE", "Description": "Order Nov 8 Store Sale", "Amount_CAD": 11.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-08 04:45:00", "Category": "REVENUE", "Description": "Order Nov 8 Store Sale", "Amount_CAD": 9.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-08 04:45:43", "Category": "REVENUE", "Description": "Order WON-12B1ZKYFEWFB", "Amount_CAD": 11.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-08 04:45:43", "Category": "REVENUE", "Description": "Order Nov 8 Store Sale", "Amount_CAD": 12.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-09 04:30:00", "Category": "REVENUE", "Description": "Order #1049 Store Sale", "Amount_CAD": 12.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-09 07:00:00", "Category": "REVENUE", "Description": "Order #1048 Store Sale", "Amount_CAD": 19.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-09 08:00:36", "Category": "REVENUE", "Description": "Order WON-S9NNJA84X779", "Amount_CAD": 9.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-09 10:00:22", "Category": "REVENUE", "Description": "Order WON-XKCJKSE3LZ8C", "Amount_CAD": 8.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-09 16:30:17", "Category": "REVENUE", "Description": "Order WON-OFHX2FTPIVB7", "Amount_CAD": 8.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-09 23:15:00", "Category": "REVENUE", "Description": "Order Nov 9 11:15 PM Sale", "Amount_CAD": 8.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-10 01:15:29", "Category": "REVENUE", "Description": "Order WON-R48BGLMDQ452", "Amount_CAD": 8.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-10 06:16:00", "Category": "REVENUE", "Description": "Order Nov 10 6:16 AM Sale", "Amount_CAD": 8.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-10 08:15:00", "Category": "REVENUE", "Description": "Order Nov 10 8:15 AM Sale", "Amount_CAD": 10.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-10 10:15:25", "Category": "REVENUE", "Description": "Order WON-YTJO7SWDWUVQ", "Amount_CAD": 7.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-11 01:15:42", "Category": "REVENUE", "Description": "Order WON-PWH6CWMNSZ35", "Amount_CAD": 9.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-11 02:00:00", "Category": "EXPENSE", "Description": "Sellvia Store Addon Purchase", "Amount_CAD": 378.00, "Vendor": "Sellvia", "CRA_Line": "Line 8810"},
    {"Date": "2026-11-11 02:30:00", "Category": "EXPENSE", "Description": "Sellvia Wholesale Order Fulfillment (WON-PWH6CWMNSZ35)", "Amount_CAD": 4.95, "Vendor": "Sellvia", "CRA_Line": "Line 8810"},
    {"Date": "2026-11-11 04:17:00", "Category": "REVENUE", "Description": "Order Nov 11 4:17 AM Sale", "Amount_CAD": 19.98, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-11 06:01:00", "Category": "REVENUE", "Description": "Order Nov 11 6:01 AM Sale", "Amount_CAD": 10.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-11 07:45:29", "Category": "REVENUE", "Description": "Order WON-34B7IPOO2SMI", "Amount_CAD": 11.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-11 23:59:00", "Category": "REVENUE", "Description": "Order Nov 11-12 Store Sales Batch (3 Orders)", "Amount_CAD": 30.97, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-12 04:01:00", "Category": "REVENUE", "Description": "Order Nov 12 4:01 AM Sale", "Amount_CAD": 11.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-12 04:32:00", "Category": "REVENUE", "Description": "Order Nov 12 4:32 AM Sale", "Amount_CAD": 18.98, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-12 05:16:10", "Category": "REVENUE", "Description": "Order WON-XI1LFCX9HLFV", "Amount_CAD": 6.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-12 08:30:00", "Category": "REVENUE", "Description": "Order Nov 12 Morning Store Sale", "Amount_CAD": 11.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-12 09:00:21", "Category": "REVENUE", "Description": "Order WON-MGX8VOV8TNEW", "Amount_CAD": 12.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-12 13:15:00", "Category": "REVENUE", "Description": "Order Nov 12 1:15 PM Sale", "Amount_CAD": 12.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-12 20:10:00", "Category": "EXPENSE", "Description": "Sellvia Wholesale Order Fulfillment (11 Paid Orders Batch)", "Amount_CAD": 69.79, "Vendor": "Sellvia", "CRA_Line": "Line 8810"},
    {"Date": "2026-11-12 23:59:00", "Category": "REVENUE", "Description": "Order Nov 12-13 Store Sales Batch (Remaining Delta)", "Amount_CAD": 51.96, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-13 04:16:00", "Category": "REVENUE", "Description": "Order Nov 13 4:16 AM Sale", "Amount_CAD": 12.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-13 06:01:00", "Category": "REVENUE", "Description": "Order Nov 13 6:01 AM Sale", "Amount_CAD": 18.98, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-13 09:30:29", "Category": "REVENUE", "Description": "Order WON-6ZE0D2I4AAXV", "Amount_CAD": 12.99, "Vendor": "Shopify", "CRA_Line": "Line 8230"},
    {"Date": "2026-11-13 10:43:00", "Category": "EXPENSE", "Description": "Sellvia Wholesale Order Fulfillment (18 Paid Orders Batch)", "Amount_CAD": 121.39, "Vendor": "Sellvia", "CRA_Line": "Line 8810"}
]

def create_ledger():
    sorted_txs = sorted(TRANSACTIONS, key=lambda x: x["Date"])
    with open(LEDGER_FILE, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(sorted_txs)

    monthly_totals = defaultdict(float)
    for t in sorted_txs:
        month = t["Date"][:7]
        monthly_totals[(month, t["Category"], t["CRA_Line"])] += t["Amount_CAD"]

    with open(SUMMARY_FILE, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Month", "Category", "CRA_Line", "Total_CAD"])
        for (month, cat, line), total in sorted(monthly_totals.items()):
            writer.writerow([month, cat, line, f"{total:.2f}"])

    total_revenue = sum(t["Amount_CAD"] for t in sorted_txs if t["Category"] == "REVENUE")
    total_expenses = sum(t["Amount_CAD"] for t in sorted_txs if t["Category"] == "EXPENSE")
    net_profit = total_revenue - total_expenses

    print(f"Generated '{LEDGER_FILE}' ({len(sorted_txs)} rows) and '{SUMMARY_FILE}'.")
    print(f"Gross Revenue (Line 8230): ${total_revenue:.2f} CAD")
    print(f"Total Expenses (Line 8810): ${total_expenses:.2f} CAD")
    print(f"Net Ledger Profit: ${net_profit:.2f} CAD")

if __name__ == "__main__":
    create_ledger()
