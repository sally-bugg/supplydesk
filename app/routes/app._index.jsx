import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Badge, Banner, Divider, Button, Box,
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
  const pendingPOs = purchaseOrders.length;

  return json({ materials: materials.length, outOfStock, lowStock, totalValue, productionRuns, pendingPOs });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;

const statStyle = {
  background: "#0a0a0a",
  border: "1px solid #1f1f1f",
  borderRadius: "8px",
  padding: "20px 24px",
  minWidth: "160px",
  flex: 1,
};

const labelStyle = {
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#666",
  marginBottom: "8px",
};

const valueStyle = (tone) => ({
  fontSize: "28px",
  fontWeight: 700,
  color: tone === "critical" ? "#ff4444" : tone === "warning" ? "#f0a500" : "#ffffff",
  lineHeight: 1.1,
});

export default function Dashboard() {
  const { materials, outOfStock, lowStock, totalValue, productionRuns, pendingPOs } = useLoaderData();

  return (
    <Page title="Dashboard">
      <style>{`
        .sd-page { background: #0d0d0d; min-height: 100vh; }
        .Polaris-Page { background: #0d0d0d; }
        .Polaris-Page-Header__Title { color: #fff !important; font-size: 22px !important; font-weight: 700 !important; letter-spacing: -0.01em; }
        .Polaris-Card { background: #111 !important; border: 1px solid #1f1f1f !important; border-radius: 8px !important; box-shadow: none !important; }
        .Polaris-Text--root { color: #ccc; }
        .Polaris-DataTable__Cell { border-color: #1f1f1f !important; color: #ccc !important; }
        .Polaris-DataTable__Cell--header { background: #0a0a0a !important; color: #888 !important; font-size: 11px !important; letter-spacing: 0.06em !important; text-transform: uppercase !important; }
        .Polaris-IndexTable__TableRow { border-color: #1f1f1f !important; }
        .Polaris-Divider { border-color: #1f1f1f !important; }
        .Polaris-Badge { font-size: 11px !important; }
        .Polaris-Button--primary { background: #fff !important; color: #000 !important; border: none !important; font-weight: 600 !important; }
        .Polaris-Button--primary:hover { background: #e0e0e0 !important; }
        .Polaris-Button:not(.Polaris-Button--primary) { background: #1a1a1a !important; color: #ccc !important; border-color: #2a2a2a !important; }
        .Polaris-Tabs__Tab { color: #888 !important; }
        .Polaris-Tabs__Tab--selected { color: #fff !important; border-bottom-color: #fff !important; }
        .Polaris-Select__Input { background: #1a1a1a !important; color: #ccc !important; border-color: #2a2a2a !important; }
        .Polaris-TextField__Input { background: #1a1a1a !important; color: #fff !important; border-color: #2a2a2a !important; }
        .Polaris-TextField__Backdrop { background: #1a1a1a !important; border-color: #2a2a2a !important; }
        .Polaris-Modal-Dialog__Modal { background: #111 !important; border: 1px solid #2a2a2a !important; }
        .Polaris-Modal-Header { border-bottom: 1px solid #1f1f1f !important; }
        .Polaris-Modal-Footer { border-top: 1px solid #1f1f1f !important; }
        .Polaris-Banner { background: #1a1a1a !important; border-color: #2a2a2a !important; }
        .Polaris-EmptyState__Image { opacity: 0.3; filter: invert(1); }
        .Polaris-Navigation__Item { color: #ccc !important; }
      `}</style>

      <Layout>
        {(outOfStock > 0 || lowStock > 0) && (
          <Layout.Section>
            <Banner
              tone="warning"
              title={`${outOfStock + lowStock} stock alert${outOfStock + lowStock > 1 ? "s" : ""} require attention`}
              action={{ content: "View Materials", url: "/app/materials" }}
            >
              {outOfStock > 0 && <p>{outOfStock} material(s) are completely out of stock.</p>}
              {lowStock > 0 && <p>{lowStock} material(s) are below reorder point.</p>}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {[
              { label: "Total Materials", value: materials, tone: null },
              { label: "Out of Stock", value: outOfStock, tone: outOfStock > 0 ? "critical" : null },
              { label: "Low Stock", value: lowStock, tone: lowStock > 0 ? "warning" : null },
              { label: "Stock Value", value: fmt(totalValue), tone: null },
              { label: "Pending POs", value: pendingPOs, tone: pendingPOs > 0 ? "warning" : null },
            ].map(({ label, value, tone }) => (
              <div key={label} style={statStyle}>
                <div style={labelStyle}>{label}</div>
                <div style={valueStyle(tone)}>{value}</div>
              </div>
            ))}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingSm" as="h2" fontWeight="bold">Recent Production Runs</Text>
                <Button url="/app/production" variant="plain">View all</Button>
              </InlineStack>
              <Divider />
              {productionRuns.length === 0 ? (
                <Text tone="subdued">No production runs yet.</Text>
              ) : (
                <BlockStack gap="300">
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
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h2" fontWeight="bold">Quick Actions</Text>
              <Divider />
              <InlineStack gap="300" wrap>
                <Button url="/app/materials">Add Material</Button>
                <Button url="/app/bom">Manage BOMs</Button>
                <Button url="/app/production">Log Production</Button>
                <Button url="/app/purchase-orders">Create PO</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
