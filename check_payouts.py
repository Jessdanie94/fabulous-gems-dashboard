import os
import csv

def check_payout_status(ledger_file="2026_cra_ledger.csv"):
    print("\n==================================================")
    print("      WONDERFUL GEMS POINT - PAYOUT AUDIT        ")
    print("==================================================\n")
    
    total_revenue = 0.0
    total_expenses = 0.0
    
    if os.path.exists(ledger_file):
        with open(ledger_file, mode="r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    amount = float(row["Amount_CAD"])
                    category = row["Category"].upper()
                    if category == "REVENUE":
                        total_revenue += amount
                    elif category == "EXPENSE":
                        total_expenses += amount
                except (ValueError, KeyError):
                    pass

    net_cleared_balance = total_revenue - total_expenses

    print(f"Total Gross Sales Logged (Line 8230):  ${total_revenue:10.2f} CAD")
    print(f"Total Expenses Settled  (Line 8810):  ${total_expenses:10.2f} CAD")
    print(f"--------------------------------------------------")
    print(f"Current Net Cleared Balance:          ${net_cleared_balance:10.2f} CAD\n")

    if net_cleared_balance > 0:
        fulfillment_reserve = net_cleared_balance * 0.50
        overhead_reserve    = net_cleared_balance * 0.30
        owner_draw          = net_cleared_balance * 0.20

        print("==================================================")
        print("        RECOMMENDED 50/30/20 ALLOCATION          ")
        print("==================================================")
        print(f"1. Fulfillment Reserve (50%):          ${fulfillment_reserve:10.2f} CAD")
        print(f"2. Operating Overhead  (30%):          ${overhead_reserve:10.2f} CAD")
        print(f"3. Owner Draw Transfer (20%):          ${owner_draw:10.2f} CAD")
        print("==================================================\n")

if __name__ == "__main__":
    check_payout_status()
