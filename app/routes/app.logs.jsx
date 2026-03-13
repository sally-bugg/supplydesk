import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Badge, Text,
  InlineStack, BlockStack, EmptyState, Select, Box, InlineGrid,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const movements = await prisma.stockMovement.findMany({ where: { shop }, include: { material: true }, orderBy: { createdAt: "desc" }, take: 200 });
  return json({ movements });
}

const TYPE_TONE = { ORDER: "info", PRODUCTION: "attention", PURCHASE: "success", CANCEL: "warning", REFUND: "warning" };

export default function Logs() {
  const { movements } = useLoaderData();
  const [filter, setFilter] = useState("ALL");
  const types = ["ALL", ...Array.from(new Set(movements.map(m => m.type)))];
  const filtered = filter === "ALL" ? movements : movements.filter(m => m.type === filter);
  const totalIn = movements.filter(m => m.qty > 0).reduce((s, m) => s + m.qty, 0);
  const totalOut = movements.filter(m => m.qty < 0).reduce((s, m) => s + Math.abs(m.qty), 0);

  return (
    <Page title="Stock Log">
      <Layout>
        <Layout.Section>
          <InlineGrid columns={3} gap="400">
            {[
              { label: "Total Movements", value: movements.length },
              { label: "Stock In", value: `+${totalIn.toFixed(0)}`, tone: "success" },
              { label: "Stock Out", value: `-${totalOut.toFixed(0)}`, tone: "critical" },
            ].map(({ label, value, tone }) => (
              <Card key={label}>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">{label}</Text>
                  <Text variant="heading2xl" as="p" tone={tone}>{value}</Text>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <InlineStack align="end">
                <div style={{ minWidth: "180px" }}>
                  <Select label="" labelHidden options={types.map(t => ({ label: t === "ALL" ? "All Types" : t, value: t }))} value={filter} onChange={setFilter} />
                </div>
              </InlineStack>
            </Box>
            {filtered.length === 0
              ? <EmptyState heading="No movements yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Movements are recorded automatically when orders are placed, cancelled, refunded, or production runs are logged.</p>
                </EmptyState>
              : <DataTable
                  columnContentTypes={["text","text","text","text","text","text"]}
                  headings={["Date","Material","Type","Qty","Reference","Note"]}
                  rows={filtered.map(m => [
                    <Text variant="bodySm" tone="subdued">{new Date(m.createdAt).toLocaleString()}</Text>,
                    <Text fontWeight="medium">{m.material?.name ?? "—"}</Text>,
                    <Badge tone={TYPE_TONE[m.type] || "info"}>{m.type}</Badge>,
                    <Text fontWeight="bold" tone={m.qty < 0 ? "critical" : "success"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</Text>,
                    <Text variant="bodySm">{m.reference}</Text>,
                    <Text variant="bodySm" tone="subdued">{m.note || "—"}</Text>,
                  ])}
                />
            }
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
