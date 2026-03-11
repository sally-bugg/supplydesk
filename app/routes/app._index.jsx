import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Badge, Banner, Button, Divider, InlineGrid,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [materials, productionRuns, purchaseOrders] = await Promise.all([
    prisma.material.findMany({ where: { shop } }),
    prisma.productionRun.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 5, include: { product: true } }),
    prisma.purchaseOrder.findMany({ where: { shop, status: "draft" } }),
  ]);
  const outOfStock = materials.filter(m => m.stock <= 0).length;
  const lowStock = materials.filter(m => m.stock > 0 && m.stock <= m.reorderPoint).length;
  const totalValue = materials.reduce((s, m) => s + m.stock * m.cost, 0);
  return json({ totalMaterials: materials.length, outOfStock, lowStock, totalValue, productionRuns, pendingPOs: purchaseOrders.length });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;

export default function Dashboard() {
  const { totalMaterials, outOfStock, lowStock, totalValue, productionRuns, pendingPOs } = useLoaderData();
  return (
    <Page title="Dashboard">
      <Layout>
        {(outOfStock > 0 || lowStock > 0) && (
          <Layout.Section>
            <Banner tone="warning" title={`${outOfStock + lowStock} stock alert(s) require attention`} action={{ content: "View Materials", url: "/app/materials" }}>
              {outOfStock > 0 && <p>{outOfStock} material(s) are out of stock.</p>}
              {lowStock > 0 && <p>{lowStock} material(s) are below reorder point.</p>}
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <InlineGrid columns={4} gap="400">
            {[
              { label: "Total Materials", value: totalMaterials },
              { label: "Out of Stock", value: outOfStock, tone: outOfStock > 0 ? "critical" : undefined },
              { label: "Low Stock", value: lowStock, tone: lowStock > 0 ? "caution" : undefined },
              { label: "Stock Value", value: fmt(totalValue) },
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
          <InlineGrid columns={2} gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Recent Production Runs</Text>
                  <Button url="/app/production" variant="plain">View all</Button>
                </InlineStack>
                <Divider />
                {productionRuns.length === 0
                  ? <Text tone="subdued" variant="bodySm">No production runs yet.</Text>
                  : <BlockStack gap="300">
                      {productionRuns.map(run => (
                        <InlineStack key={run.id} align="space-between">
                          <BlockStack gap="050">
                            <Text fontWeight="medium">{run.product.name}</Text>
                            <Text variant="bodySm" tone="subdued">{new Date(run.createdAt).toLocaleDateString()}</Text>
                          </BlockStack>
                          <Badge>{run.qty} units</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                }
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Quick Actions</Text>
                <Divider />
                <BlockStack gap="200">
                  <Button url="/app/materials" fullWidth textAlign="left">Add Raw Material</Button>
                  <Button url="/app/bom" fullWidth textAlign="left">Manage Bill of Materials</Button>
                  <Button url="/app/production" fullWidth textAlign="left">Log Production Run</Button>
                  <Button url="/app/purchase-orders" fullWidth textAlign="left">Create Purchase Order</Button>
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
