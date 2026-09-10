import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
  Box,
  InlineStack,
  Badge,
  Grid,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getDashboardData } from "../services/sellvia.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  let sellviaData = null;
  let shopifyData = {
    balance: "0.00",
    currency: "USD",
    rows: [] as string[][],
  };

  try {
    // Fetch Sellvia analytics data
    sellviaData = await getDashboardData();
  } catch (error) {
    console.error("Error fetching Sellvia data:", error);
    // Continue without Sellvia data if there's an error
  }

  // TODO: connect to Shopify Finances API for real payout data
  // For now, using placeholder data

  return json({
    shopify: shopifyData,
    sellvia: sellviaData,
  });
};

export default function PayoutsDashboard() {
  const { shopify, sellvia } = useLoaderData<typeof loader>();

  // Format currency
  const formatCurrency = (amount: number | undefined, currency = "USD") => {
    if (!amount) return `${currency} $0.00`;
    return `${currency} $${(amount / 100).toFixed(2)}`;
  };

  // Prepare product rows for data table
  const productRows =
    sellvia?.products?.map((product: any) => [
      product.name || "Unknown Product",
      product.units_sold?.toString() || "0",
      formatCurrency(product.revenue),
    ]) || [];

  return (
    <Page>
      <TitleBar title="Revenue & Payouts Dashboard" />
      <BlockStack gap="500">
        <Text as="h1" variant="headingXl">
          fabulousgemsparlor.store – Revenue & Payouts
        </Text>

        {/* Key Metrics Section */}
        <Layout>
          <Layout.Section>
            <Grid columns={{ xs: 1, sm: 2, md: 4 }}>
              {/* Shopify Balance Card */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Shopify Balance
                  </Text>
                  <Text as="p" variant="headingLg" tone="success">
                    {shopify.currency} ${shopify.balance}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Pending payout
                  </Text>
                </BlockStack>
              </Card>

              {/* Sellvia Revenue Card */}
              {sellvia?.revenue && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Monthly Revenue
                    </Text>
                    <Text as="p" variant="headingLg" tone="success">
                      {formatCurrency(sellvia.revenue.revenue)}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Sellvia + Shopify
                    </Text>
                  </BlockStack>
                </Card>
              )}

              {/* Orders Card */}
              {sellvia?.orders && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Total Orders
                    </Text>
                    <Text as="p" variant="headingLg">
                      {sellvia.orders.orders || 0}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      This month
                    </Text>
                  </BlockStack>
                </Card>
              )}

              {/* Average Order Value Card */}
              {sellvia?.orders && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Avg Order Value
                    </Text>
                    <Text as="p" variant="headingLg">
                      {formatCurrency(
                        sellvia.orders.average_order_value
                      )}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Per transaction
                    </Text>
                  </BlockStack>
                </Card>
              )}
            </Grid>
          </Layout.Section>
        </Layout>

        {/* Analytics Section */}
        <Layout>
          {/* Top Products */}
          {sellvia?.products && sellvia.products.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Top Performing Products
                  </Text>
                  <Box>
                    <DataTable
                      columnContentTypes={["text", "numeric", "numeric"]}
                      headings={["Product Name", "Units Sold", "Revenue"]}
                      rows={productRows}
                      emptyState={
                        <Box padding="400">
                          <Text
                            as="p"
                            variant="bodyMd"
                            alignment="center"
                          >
                            No product data available.
                          </Text>
                        </Box>
                      }
                    />
                  </Box>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* Customer Analytics */}
          {sellvia?.customers && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Customer Analytics
                  </Text>
                  <InlineStack gap="400">
                    <Box>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Unique Visitors
                      </Text>
                      <Text as="p" variant="headingMd">
                        {sellvia.customers.unique_visitors || "N/A"}
                      </Text>
                    </Box>
                    <Box>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Conversion Rate
                      </Text>
                      <Text as="p" variant="headingMd">
                        {sellvia.customers.conversion_rate
                          ? `${(
                              sellvia.customers.conversion_rate * 100
                            ).toFixed(2)}%`
                          : "N/A"}
                      </Text>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>

        {/* Shopify Payouts Section */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Recent Payouts
                  </Text>
                  <Badge tone="info">Shopify Payments</Badge>
                </InlineStack>

                <Box>
                  <DataTable
                    columnContentTypes={["text", "numeric", "text"]}
                    headings={["Status", "Amount", "Date"]}
                    rows={shopify.rows}
                    emptyState={
                      <Box padding="400">
                        <Text
                          as="p"
                          variant="bodyMd"
                          alignment="center"
                        >
                          No payouts to display yet.
                        </Text>
                      </Box>
                    }
                  />
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Last Updated */}
        {sellvia?.timestamp && (
          <Box padding="400">
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
              Last updated: {new Date(sellvia.timestamp).toLocaleString()}
            </Text>
          </Box>
        )}
      </BlockStack>
    </Page>
  );
}
