# Billing Plan Investigation Notes

## Background

The original brief flagged two Shopify billing IDs (5809673777 and 574805867) as
possibly duplicate active billing plans.

## Finding

These IDs are **Shopify store IDs**, not recurring application charge IDs.
`who-charged-me.js` was written to identify *which store* was generating a charge
by matching a store's numeric ID against those two values — not to cancel charges.

The IDs were associated with two of the original three stores in the dashboard.

## Current Status (as of 2026-09-19)

Jesse now operates a **single store only**: `fabulousgemsparlor.store`.
The two other stores have been removed. If either of those stores had an active
Shopify app subscription (recurring application charge), that charge would have
been automatically cancelled by Shopify when the app was uninstalled from the store.

## Action Required

No programmatic action is possible or needed from this codebase. To confirm:

1. Log in to your Shopify Partners dashboard at https://partners.shopify.com
2. Go to **Apps → Fabulous Gems Dashboard → Billing**
3. Verify that only `fabulousgemsparlor.store` appears as an active installation
   with a billing record.
4. If either removed store still shows an active charge, cancel it manually from
   the Partners dashboard or ask Shopify Support.

The `who-charged-me.js` script can be updated to reference only the single
remaining store if needed in future diagnostics.
