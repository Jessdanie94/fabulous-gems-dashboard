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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShopifyPayouts } from "../services/shopify-finances.server";
import { formatPayoutRows } from "../services/shopify-finances";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  let shopifyPayouts = {
    balance: {
      amount: "0.00",
      currency: "USD",
    },
    payouts: [] as Array<{
      status: string;
      amount: string;
      currency: string;
      issuedAt: string;
    }>,
  };

  try {
    // Fetch real Shopify payout data
    shopifyPayouts = await getShopifyPayouts(request);
  } catch (error) {
    console.error("Error fetching Shopify payouts:", error);
    // Continue with placeholder data if there's an error
  }

  return json({
    shopify: shopifyPayouts,
  });
};

export default function PayoutsDashboard() {
  const { shopify } = useLoaderData<typeof loader>();

  // Format payout rows from Shopify data
  const payoutRows = formatPayoutRows(shopify.payouts);

  return (
    <Page>
      <TitleBar title="Revenue & Payouts Dashboard" />
      <BlockStack gap="500">
        <Text as="h1" variant="headingXl">
          fabulousgemsparlor.store – Revenue & Payouts
        </Text>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">Shopify Balance</Text>
                <Text as="p" variant="headingLg" tone="success">
                  {shopify.balance.currency} ${parseFloat(shopify.balance.amount).toFixed(2)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">Pending payout</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Shopify Payouts Section */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Recent Payouts (Last 10)
                  </Text>
                  <Badge tone="success">Shopify Payments</Badge>
                </InlineStack>

                <Box>
                  <DataTable
                    columnContentTypes={["text", "numeric", "text"]}
                    headings={["Status", "Amount", "Date"]}
                    rows={payoutRows}
                  />
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

      </BlockStack>
    </Page>
  );
}
