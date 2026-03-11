import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Card, DataTable, Badge, Text,
  InlineStack, BlockStack, EmptyState, Select, Box,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const movements = await prisma.stockMovement.findMany({
    where: { shop },
    include: { material: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return json({ movements });
}

const darkStyles = `
  .Polaris-Page { background: #0d0d0d; }
  .Polaris-Page-Header__Title { color: #fff !important; font-size: 22px !important; font-weight: 700 !important; }
  .Polaris-Card { background: #111 !important; border: 1px solid #1f1f1f !important; border-radius: 8px !important; box-shadow: none !important; }
  .Polaris-Text--root { color: #ccc; }
  .Polaris-DataTable__Cell { border-color: #1f1f1f !important; color: #ccc !important; }
  .Polaris-DataTable__Cell--header { background: #0a0a0a !important; color: #666 !important; font-size: 11px !important; letter-spacing: 0.06em !important; text-transform: uppercase !important; }
  .Polaris-Divider { border-color: #1f1f1f !important; }
  .Polaris-Button--primary { background: #fff !important; color: #000 !important; border: none !important; font-weight: 600 !important; }
  .Polaris-Button:not(.Polaris-Button--primary) { background: #1a1a1a !important; color: #ccc !important; border-color: #2a2a2a !important; }
  .Polaris-Select__Input { background: #1a1a1a !important; color: #ccc !important; border-color: #2a2a2a !important; }
  .Polaris-EmptyState__Image { opacity: 0.3; filter: invert(1); }
`;

const TYPE_COLORS = {
  ORDER: "#3b82f6",
  PRODUCTION: "#a855f7",
  PURCHASE: "#22c55e",
  CANCEL: "#f0a500",
  REFUND: "#f0a500",
};

export default function Logs() {
  const { movements } = useLoaderData();
  const [filter, setFilter] = useState("ALL");

  const types = ["ALL", ...Array.from(new Set(movements.map(m => m.type)))];
  const filtered = filter === "ALL" ? movements : movements.filter(m => m.type === filter);

  const totalIn = movements.filter(m => m.qty > 0).reduce((s, m) => s + m.qty, 0);
  const totalOut = movements.filter(m => m.qty < 0).reduce((s, m) => s + Math.abs(m.qty), 0);

  return (
    <Page title="Stock Log">
      <style>{darkStyles}</style>
      <Layout>
        <Layout.Section>
          <div style={{ display: "flex", gap: "12px", marginBottom: "4px" }}>
            {[
              { label: "TOTAL MOVEMENTS", value: movements.length },
              { label: "STOCK IN", value: `+${totalIn.toFixed(0)}`, color: "#22c55e" },
              { label: "STOCK OUT", value: `-${totalOut.toFixed(0)}`, color: "#ff4444" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "#0a0a0a", border: "1px solid #1f1f1f", borderRadius: "8px", padding: "16px 20px", flex: 1 }}>
                <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: "#555", marginBottom: "6px" }}>{label}</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: color || "#fff" }}>{value}</div>
              </div>
            ))}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <InlineStack align="end">
                <div style={{ minWidth: "180px" }}>
                  <Select label="" labelHidden
                    options={types.map(t => ({ label: t === "ALL" ? "All Types" : t, value: t }))}
                    value={filter} onChange={setFilter}
                  />
                </div>
              </InlineStack>
            </Box>
            {filtered.length === 0 ? (
              <EmptyState
                heading="No movements yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Movements are recorded automatically when orders are placed, cancelled, refunded, or production runs are logged.</p>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                headings={["Date", "Material", "Type", "Qty", "Reference", "Note"]}
                rows={filtered.map(m => [
                  <Text variant="bodySm" tone="subdued">{new Date(m.createdAt).toLocaleString()}</Text>,
                  <Text fontWeight="medium">{m.material?.name ?? "—"}</Text>,
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "4px", background: `${TYPE_COLORS[m.type] || "#666"}22`, border: `1px solid ${TYPE_COLORS[m.type] || "#666"}44`, color: TYPE_COLORS[m.type] || "#ccc", fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em" }}>{m.type}</span>,
                  <Text fontWeight="bold" tone={m.qty < 0 ? "critical" : "success"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</Text>,
                  <Text variant="bodySm">{m.reference}</Text>,
                  <Text variant="bodySm" tone="subdued">{m.note || "—"}</Text>,
                ])}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
