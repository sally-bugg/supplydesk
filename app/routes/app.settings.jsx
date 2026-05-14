import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  Divider,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../shopify.server";
import { disconnectXero } from "../xero.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const xeroToken = await prisma.xeroToken.findUnique({
    where: { shop: session.shop },
  });
  const url = new URL(request.url);
  return json({
    connected: !!xeroToken,
    justConnected: url.searchParams.get("xero") === "connected",
    xeroError: url.searchParams.get("xero") === "error",
  });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  if (fd.get("intent") === "disconnectXero") {
    await disconnectXero(session.shop);
  }
  return json({ ok: true });
}

export default function Settings() {
  const { connected, justConnected, xeroError } = useLoaderData();
  const submit = useSubmit();

  function handleConnect() {
    window.open("/auth/xero", "_top");
  }

  function handleDisconnect() {
    if (confirm("Disconnect Xero? Bills will no longer be created automatically.")) {
      submit({ intent: "disconnectXero" }, { method: "post" });
    }
  }

  return (
    <Page title="Settings">
      <BlockStack gap="500">
        {justConnected && (
          <Banner title="Xero connected!" tone="success">
            <p>Purchase Orders marked as Received will now create a Bill in Xero.</p>
          </Banner>
        )}
        {xeroError && (
          <Banner title="Xero connection failed" tone="critical">
            <p>Something went wrong. Please try connecting again.</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">Xero Integration</Text>
                <Text tone="subdued">
                  Automatically create a Bill in Xero when a Purchase Order is marked as Received.
                </Text>
              </BlockStack>
              {connected ? (
                <Badge tone="success">Connected</Badge>
              ) : (
                <Badge tone="attention">Not connected</Badge>
              )}
            </InlineStack>

            <Divider />

            {connected ? (
              <BlockStack gap="300">
                <Text>
                  SupplyDesk is connected to Xero. When you mark a PO as Received, a draft Bill
                  will appear in Xero under Accounts Payable → Bills to Pay.
                </Text>
                <Button tone="critical" onClick={handleDisconnect}>
                  Disconnect Xero
                </Button>
              </BlockStack>
            ) : (
              <BlockStack gap="300">
                <Text>
                  Connect your Xero organisation to sync Purchase Orders as Bills automatically.
                </Text>
                <Button variant="primary" onClick={handleConnect}>
                  Connect to Xero
                </Button>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
