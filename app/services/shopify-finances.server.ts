import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "@remix-run/node";

/**
 * Shopify Finances API Service
 * Fetches payout data from Shopify Payments
 */

interface ShopifyPayout {
  id: string;
  status: string;
  amount: {
    amount: string;
    currency_code: string;
  };
  issued_at: string;
}

interface PayoutResponse {
  payouts: {
    edges: Array<{
      node: ShopifyPayout;
    }>;
  };
}

/**
 * Get pending balance and recent payouts from Shopify Payments
 */
export async function getShopifyPayouts(request: LoaderFunctionArgs["request"]) {
  try {
    const admin = await authenticate.admin(request);

    // GraphQL query to fetch payouts and balance
    const query = `
      {
        shopPaymentAccount {
          balance {
            amount
            currencyCode
          }
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
    `;

    const response = await admin.graphql(query);
    const data = (await response.json()) as {
      data: {
        shopPaymentAccount: {
          balance: {
            amount: string;
            currencyCode: string;
          };
        };
        payouts: {
          edges: Array<{
            node: ShopifyPayout;
          }>;
        };
      };
    };

    if (!data.data) {
      throw new Error("Invalid response from Shopify API");
    }

    const balance = data.data.shopPaymentAccount?.balance || {
      amount: "0.00",
      currencyCode: "USD",
    };
    const payouts = data.data.payouts?.edges || [];

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
