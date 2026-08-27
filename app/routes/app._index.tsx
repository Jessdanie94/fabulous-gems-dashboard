import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Badge,
  DataTable,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

interface PayoutNode {
  id: string;
  status: string;
  issuedAt: string;
  net: {
    amount: string;
    currencyCode: string;
  };
}

interface LoaderData {
  pendingBalance: { amount: string; currencyCode: string } | null;
  payouts: PayoutNode[];
  error: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(
      `#graphql
        query getPayouts {
          shopifyPaymentsAccount {
            balance {
              pending {
                amount
                currencyCode
              }
            }
            payouts(first: 10, sortKey: ISSUED_AT, reverse: true) {
              edges {
                node {
                  id
                  status
                  issuedAt
                  net {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      `,
    );

    const responseJson = await response.json();

    const account = responseJson.data?.shopifyPaymentsAccount;

    if (!account) {
      return json<LoaderData>({
        pendingBalance: null,
        payouts: [],
        error:
          "Shopify Payments is not enabled on this store, or the app lacks the required permissions.",
      });
    }

    const pendingBalances = account.balance?.pending;
    const pendingBalance =
      pendingBalances && pendingBalances.length > 0
        ? pendingBalances[0]
        : null;

    const payouts: PayoutNode[] =
      account.payouts?.edges?.map(
        (edge: { node: PayoutNode }) => edge.node,
      ) ?? [];

    return json<LoaderData>({
      pendingBalance,
      payouts,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json<LoaderData>({
      pendingBalance: null,
      payouts: [],
      error: `Failed to fetch payout data: ${message}`,
    });
  }
};

function formatCurrency(amount: string, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(parseFloat(amount));
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusTone(
  status: string,
): "success" | "attention" | "critical" | "info" | undefined {
  switch (status.toUpperCase()) {
    case "PAID":
      return "success";
    case "IN_TRANSIT":
      return "info";
    case "SCHEDULED":
      return "attention";
    case "FAILED":
    case "CANCELED":
      return "critical";
    default:
      return undefined;
  }
}

export default function PayoutDashboard() {
  const { pendingBalance, payouts, error } = useLoaderData<LoaderData>();

  const rows = payouts.map((payout) => [
    formatDate(payout.issuedAt),
    formatCurrency(payout.net.amount, payout.net.currencyCode),
    payout.status,
  ]);

  return (
    <Page>
      <TitleBar title="Payout Dashboard" />
      <BlockStack gap="500">
        {error && (
          <Banner tone="warning">
            <p>{error}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Pending Balance
                </Text>
                {pendingBalance ? (
                  <Text as="p" variant="headingXl">
                    {formatCurrency(
                      pendingBalance.amount,
                      pendingBalance.currencyCode,
                    )}
                  </Text>
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No pending balance available
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Last 10 Payouts
                  </Text>
                  {payouts.length > 0 && (
                    <Badge>{`${payouts.length} payout${payouts.length !== 1 ? "s" : ""}`}</Badge>
                  )}
                </InlineStack>
                {payouts.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "text"]}
                    headings={["Date", "Amount", "Status"]}
                    rows={rows}
                  />
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No payouts found
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
