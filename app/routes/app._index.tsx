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
  InlineGrid,
  Badge,
  DataTable,
  Banner,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// --- Types ---

interface MoneyV2 {
  amount: string;
  currencyCode: string;
}

interface OrderTransaction {
  gateway: string;
  amountSet: {
    shopMoney: MoneyV2;
  };
}

interface OrderFulfillment {
  status: string;
  trackingInfo: { number: string | null }[];
}

interface OrderMetafield {
  namespace: string;
  key: string;
  value: string;
}

interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  totalPriceSet: { shopMoney: MoneyV2 };
  displayFulfillmentStatus: string;
  transactions: OrderTransaction[];
  fulfillments: OrderFulfillment[];
  metafields: OrderMetafield[];
}

interface PayoutNode {
  id: string;
  status: string;
  issuedAt: string;
  net: MoneyV2;
}

interface SyncStatus {
  lastSyncTime: string;
  success: boolean;
}

interface OrderRow {
  id: string;
  name: string;
  date: string;
  amount: number;
  sellviaCost: number;
  shopifyFee: number;
  net: number;
  fulfillmentStatus: string;
  trackingNumber: string;
  currencyCode: string;
}

interface LoaderData {
  syncStatus: SyncStatus;
  orders: OrderRow[];
  totals: {
    revenue: number;
    sellviaCost: number;
    shopifyFees: number;
    netProfit: number;
    currencyCode: string;
  };
  pendingBalance: MoneyV2 | null;
  lastPayoutDate: string | null;
  payouts: PayoutNode[];
  error: string | null;
}

// --- Constants ---

const SHOPIFY_FEE_RATE = 0.029;
const SHOPIFY_FEE_FIXED = 0.30;
const SELLVIA_COST_RATE = 0.40;
const SHOPIFY_PAYMENTS_GATEWAYS = ["shopify_payments", "Shopify Payments"];

// --- Loader ---

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const syncStart = new Date().toISOString();

  try {
    const ordersResponse = await admin.graphql(
      `#graphql
        query getRecentOrders {
          orders(first: 50, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                displayFulfillmentStatus
                transactions(first: 5) {
                  gateway
                  amountSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
                fulfillments(first: 1) {
                  status
                  trackingInfo(first: 1) {
                    number
                  }
                }
                metafields(first: 5, namespace: "sellvia") {
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
      `,
    );

    const payoutsResponse = await admin.graphql(
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

    const ordersJson = await ordersResponse.json();
    const payoutsJson = await payoutsResponse.json();

    const orderEdges = ordersJson.data?.orders?.edges ?? [];
    const account = payoutsJson.data?.shopifyPaymentsAccount;

    // Filter to Shopify Payments orders only (exclude manual, Interac, etc.)
    const shopifyPaymentsOrders: OrderNode[] = orderEdges
      .map((edge: { node: OrderNode }) => edge.node)
      .filter((order: OrderNode) =>
        order.transactions.some((tx) =>
          SHOPIFY_PAYMENTS_GATEWAYS.includes(tx.gateway),
        ),
      );

    // Build order rows with calculated costs
    const orders: OrderRow[] = shopifyPaymentsOrders.map((order) => {
      const amount = parseFloat(order.totalPriceSet.shopMoney.amount);
      const currencyCode = order.totalPriceSet.shopMoney.currencyCode;

      // Sellvia cost: check metafield first, fallback to 40% estimate
      const sellviaMetafield = order.metafields.find(
        (mf) => mf.namespace === "sellvia" && mf.key === "fulfillment_cost",
      );
      const sellviaCost = sellviaMetafield
        ? parseFloat(sellviaMetafield.value)
        : amount * SELLVIA_COST_RATE;

      // Shopify transaction fee: 2.9% + $0.30
      const shopifyFee = amount * SHOPIFY_FEE_RATE + SHOPIFY_FEE_FIXED;

      const net = amount - sellviaCost - shopifyFee;

      // Fulfillment info
      const fulfillment = order.fulfillments[0];
      const trackingNumber =
        fulfillment?.trackingInfo?.[0]?.number ?? "";

      return {
        id: order.id,
        name: order.name,
        date: order.createdAt,
        amount,
        sellviaCost,
        shopifyFee,
        net,
        fulfillmentStatus: order.displayFulfillmentStatus,
        trackingNumber,
        currencyCode,
      };
    });

    // Calculate totals
    const currencyCode =
      orders.length > 0 ? orders[0].currencyCode : "CAD";
    const totals = orders.reduce(
      (acc, order) => ({
        revenue: acc.revenue + order.amount,
        sellviaCost: acc.sellviaCost + order.sellviaCost,
        shopifyFees: acc.shopifyFees + order.shopifyFee,
        netProfit: acc.netProfit + order.net,
        currencyCode,
      }),
      {
        revenue: 0,
        sellviaCost: 0,
        shopifyFees: 0,
        netProfit: 0,
        currencyCode,
      },
    );

    // Payout data
    const pendingBalances = account?.balance?.pending;
    const pendingBalance: MoneyV2 | null =
      pendingBalances && pendingBalances.length > 0
        ? pendingBalances[0]
        : null;

    const payouts: PayoutNode[] =
      account?.payouts?.edges?.map(
        (edge: { node: PayoutNode }) => edge.node,
      ) ?? [];

    const lastPayoutDate =
      payouts.length > 0 ? payouts[0].issuedAt : null;

    return json<LoaderData>({
      syncStatus: { lastSyncTime: syncStart, success: true },
      orders,
      totals,
      pendingBalance,
      lastPayoutDate,
      payouts,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json<LoaderData>({
      syncStatus: { lastSyncTime: syncStart, success: false },
      orders: [],
      totals: {
        revenue: 0,
        sellviaCost: 0,
        shopifyFees: 0,
        netProfit: 0,
        currencyCode: "CAD",
      },
      pendingBalance: null,
      lastPayoutDate: null,
      payouts: [],
      error: `Failed to fetch dashboard data: ${message}`,
    });
  }
};

// --- Helpers ---

function formatCurrency(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function profitTone(value: number): "success" | "critical" {
  return value >= 0 ? "success" : "critical";
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

function fulfillmentBadgeTone(
  status: string,
): "success" | "attention" | "critical" | "info" | undefined {
  switch (status.toUpperCase()) {
    case "FULFILLED":
      return "success";
    case "PARTIALLY_FULFILLED":
    case "IN_PROGRESS":
      return "info";
    case "UNFULFILLED":
      return "attention";
    case "ON_HOLD":
    case "SCHEDULED":
      return "attention";
    default:
      return undefined;
  }
}

// --- Component ---

export default function PayoutDashboard() {
  const {
    syncStatus,
    orders,
    totals,
    pendingBalance,
    lastPayoutDate,
    payouts,
    error,
  } = useLoaderData<LoaderData>();

  const orderRows = orders.map((order) => [
    order.name,
    formatDate(order.date),
    formatCurrency(order.amount, order.currencyCode),
    formatCurrency(order.sellviaCost, order.currencyCode),
    formatCurrency(order.shopifyFee, order.currencyCode),
    formatCurrency(order.net, order.currencyCode),
    order.fulfillmentStatus.replace(/_/g, " "),
    order.trackingNumber || "—",
  ]);

  return (
    <Page>
      <TitleBar title="Payout Dashboard" />
      <BlockStack gap="500">
        {/* Sync Status Banner */}
        <Banner
          tone={syncStatus.success ? "success" : "critical"}
        >
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" fontWeight="semibold">
              Last sync:
            </Text>
            <Text as="span" variant="bodySm">
              {formatDateTime(syncStatus.lastSyncTime)}
            </Text>
            <Badge tone={syncStatus.success ? "success" : "critical"}>
              {syncStatus.success ? "Success" : "Failed"}
            </Badge>
          </InlineStack>
        </Banner>

        {error && (
          <Banner tone="warning">
            <p>{error}</p>
          </Banner>
        )}

        {/* Metric Cards Grid */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                Total Revenue
              </Text>
              <Text as="p" variant="headingLg">
                {formatCurrency(totals.revenue, totals.currencyCode)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {orders.length} Shopify Payments order{orders.length !== 1 ? "s" : ""}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                Sellvia Cost
              </Text>
              <Text as="p" variant="headingLg" tone="critical">
                {formatCurrency(totals.sellviaCost, totals.currencyCode)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                ~40% fulfillment estimate
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                Shopify Fees
              </Text>
              <Text as="p" variant="headingLg" tone="critical">
                {formatCurrency(totals.shopifyFees, totals.currencyCode)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                2.9% + $0.30 per txn
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                Net Profit
              </Text>
              <Text
                as="p"
                variant="headingLg"
                tone={profitTone(totals.netProfit)}
              >
                {formatCurrency(totals.netProfit, totals.currencyCode)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Revenue − fees − fulfillment
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Orders Table */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Orders (Shopify Payments Only)
                  </Text>
                  <Badge>
                    {`${orders.length} order${orders.length !== 1 ? "s" : ""}`}
                  </Badge>
                </InlineStack>
                {orders.length > 0 ? (
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "numeric",
                      "numeric",
                      "numeric",
                      "numeric",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "Order #",
                      "Date",
                      "Amount",
                      "Sellvia Cost",
                      "Shopify Fee",
                      "Net",
                      "Fulfillment",
                      "Tracking #",
                    ]}
                    rows={orderRows}
                    totals={[
                      "",
                      "",
                      formatCurrency(totals.revenue, totals.currencyCode),
                      formatCurrency(totals.sellviaCost, totals.currencyCode),
                      formatCurrency(totals.shopifyFees, totals.currencyCode),
                      formatCurrency(totals.netProfit, totals.currencyCode),
                      "",
                      "",
                    ]}
                    showTotalsInFooter
                  />
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No Shopify Payments orders found
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* CIBC Payout Section */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    CIBC Payout Status
                  </Text>
                  <Badge tone="info">Read Only</Badge>
                </InlineStack>

                <Divider />

                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm" tone="subdued">
                      Pending Payout Balance
                    </Text>
                    {pendingBalance ? (
                      <Text as="p" variant="headingXl" tone="caution">
                        {formatCurrency(
                          parseFloat(pendingBalance.amount),
                          pendingBalance.currencyCode,
                        )}
                      </Text>
                    ) : (
                      <Text as="p" variant="bodyMd" tone="subdued">
                        No pending balance
                      </Text>
                    )}
                  </BlockStack>

                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm" tone="subdued">
                      Last Payout Date
                    </Text>
                    {lastPayoutDate ? (
                      <Text as="p" variant="headingMd">
                        {formatDate(lastPayoutDate)}
                      </Text>
                    ) : (
                      <Text as="p" variant="bodyMd" tone="subdued">
                        No payouts yet
                      </Text>
                    )}
                  </BlockStack>
                </InlineGrid>

                <Divider />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    Recent Payouts
                  </Text>
                  {payouts.length > 0 ? (
                    <DataTable
                      columnContentTypes={["text", "numeric", "text"]}
                      headings={["Date", "Amount", "Status"]}
                      rows={payouts.map((payout) => [
                        formatDate(payout.issuedAt),
                        formatCurrency(
                          parseFloat(payout.net.amount),
                          payout.net.currencyCode,
                        ),
                        payout.status.replace(/_/g, " "),
                      ])}
                    />
                  ) : (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No payouts found
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
