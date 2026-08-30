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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // TODO: connect to Shopify Finances API
  const payouts = {
    balance: "0.00",
    currency: "USD",
    rows: [] as string[][],
  };

  return json(payouts);
};

export default function PayoutsDashboard() {
  const { balance, currency, rows } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Payouts Dashboard" />
      <BlockStack gap="500">
        <Text as="h1" variant="headingXl">
          fabulousgemsparlor.store \u2013 Payouts
        </Text>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Current Balance
                  </Text>
                  <Badge tone="info">
                    {currency} ${balance}
                  </Badge>
                </InlineStack>

                <Box>
                  <DataTable
                    columnContentTypes={["text", "numeric", "text"]}
                    headings={["Status", "Amount", "Date"]}
                    rows={rows}
                    emptyState={
                      <Box padding="400">
                        <Text as="p" variant="bodyMd" alignment="center">
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
      </BlockStack>
    </Page>
  );
}
