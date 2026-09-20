import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "@remix-run/node";

/**
 * Shopify Finances API Service
 * Fetches payout data from Shopify Payments
 *
 * NOTE: `payouts` must be nested inside `shopPaymentAccount` in the GraphQL query.
 * Placing it at the top level returns null / empty, which is why the dashboard
 * was showing $0.00. The correct schema is:
 *   shopPaymentAccount { balance { ... }  payouts(first: N) { edges { node { ... } } } }
 */

interface ShopifyPayout {
  id: string;
  status: string;
  amount: {
    amount: string;
    currencyCode: string;
  };
  issuedAt: string;
}

/**
 * Get pending balance and recent payouts from Shopify Payments.
 * Requires the `read_finances` scope on the app.
 */
export async function getShopifyPayouts(request: LoaderFunctionArgs["request"]) {
  try {
    const admin = await authenticate.admin(request);

    // `payouts` lives inside `shopPaymentAccount`, NOT at the query root.
    // Top-level `payouts` is undefined in the Admin GraphQL schema and silently
    // returns null, which caused the $0.00 balance bug.
    const query = `
      {
        shopPaymentAccount {
          balance {
            amount
            currencyCode
          }
          payouts(first: 10, reverse: true) {
            edges {
              node {
                id
                status
                amount {
                  amount
                  currencyCode
                }
                issuedAt
              }
            }
          }
        }
      }
    `;

    const response = await admin.graphql(query);
    const data = (await response.json()) as {
      data: {
        shopPaymentAccount: {
          balance: {
            amount: string;
            currencyCode: string;
          };
          payouts: {
            edges: Array<{
              node: ShopifyPayout;
            }>;
          };
        } | null;
      };
    };

    if (!data.data) {
      throw new Error("Invalid response from Shopify API");
    }

    // shopPaymentAccount is null when the store has not enabled Shopify Payments
    const account = data.data.shopPaymentAccount;
    const balance = account?.balance ?? {
      amount: "0.00",
      currencyCode: "USD",
    };
    const payouts = account?.payouts?.edges ?? [];

    return {
      balance: {
        amount: balance.amount,
        currency: balance.currencyCode,
      },
      payouts: payouts.map((edge) => ({
        id: edge.node.id,
        status: edge.node.status,
        amount: edge.node.amount.amount,
        currency: edge.node.amount.currencyCode,
        issuedAt: edge.node.issuedAt,
      })),
      // Surface whether Shopify Payments is actually enabled on this store
      paymentsEnabled: account !== null,
    };
  } catch (error) {
    console.error("Error fetching Shopify payouts:", error);
    throw error;
  }
}

/**
 * Format payout data for DataTable display
 */
export function formatPayoutRows(
  payouts: Array<{
    status: string;
    amount: string;
    currency: string;
    issuedAt: string;
  }>
) {
  return payouts.map((payout) => [
    payout.status.charAt(0).toUpperCase() + payout.status.slice(1),
    `${payout.currency} $${parseFloat(payout.amount).toFixed(2)}`,
    new Date(payout.issuedAt).toLocaleDateString(),
  ]);
}
