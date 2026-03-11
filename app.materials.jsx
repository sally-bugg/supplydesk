import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Modal, TextField, Select,
  EmptyState, Divider, Box,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const materials = await prisma.material.findMany({ where: { shop }, orderBy: { name: "asc" } });
  return json({ materials });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "addMaterial") {
    const sku = fd.get("sku");
    await prisma.material.upsert({
      where: { shop_sku: { shop, sku } },
      update: { name: fd.get("name"), unit: fd.get("unit"), stock: +fd.get("stock"), reorderPoint: +fd.get("reorderPoint"), cost: +fd.get("cost"), supplier: fd.get("supplier") || null },
      create: { shop, sku, name: fd.get("name"), unit: fd.get("unit"), stock: +fd.get("stock"), reorderPoint: +fd.get("reorderPoint"), cost: +fd.get("cost"), supplier: fd.get("supplier") || null },
    });
    return json({ ok: true });
  }
  if (intent === "editMaterial") {
    await prisma.material.update({
      where: { id: fd.get("id") },
      data: { name: fd.get("name"), unit: fd.get("unit"), stock: +fd.get("stock"), reorderPoint: +fd.get("reorderPoint"), cost: +fd.get("cost"), supplier: fd.get("supplier") || null },
    });
    return json({ ok: true });
  }
  if (intent === "deleteMaterial") {
    await prisma.material.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }
  return json({ ok: false });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;

function stockStatus(mat) {
  if (mat.stock <= 0) return "critical";
  if (mat.stock <= mat.reorderPoint) return "warning";
  return "success";
}

function StockBar({ mat }) {
  const pct = mat.reorderPoint > 0
    ? Math.min(100, (mat.stock / (mat.reorderPoint * 2)) * 100)
    : mat.stock > 0 ? 100 : 0;
  const color = mat.stock <= 0 ? "#ff4444" : mat.stock <= mat.reorderPoint ? "#f0a500" : "#22c55e";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "100px" }}>
      <div style={{ flex: 1, height: "4px", background: "#2a2a2a", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "2px", transition: "width 0.3s" }} />
      </div>
      <Text variant="bodySm" tone={mat.stock <= 0 ? "critical" : mat.stock <= mat.reorderPoint ? "caution" : undefined}>
        {mat.stock}
      </Text>
    </div>
  );
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
  .Polaris-Button--primary:hover { background: #e0e0e0 !important; }
  .Polaris-Button:not(.Polaris-Button--primary) { background: #1a1a1a !important; color: #ccc !important; border-color: #2a2a2a !important; }
  .Polaris-Select__Input { background: #1a1a1a !important; color: #ccc !important; border-color: #2a2a2a !important; }
  .Polaris-TextField__Input { background: #1a1a1a !important; color: #fff !important; border-color: #2a2a2a !important; }
  .Polaris-TextField__Backdrop { background: #1a1a1a !important; border-color: #2a2a2a !important; }
  .Polaris-Modal-Dialog__Modal { background: #111 !important; border: 1px solid #2a2a2a !important; }
  .Polaris-Modal-Header { border-bottom: 1px solid #1f1f1f !important; }
  .Polaris-Modal-Footer { border-top: 1px solid #1f1f1f !important; }
  .Polaris-Label__Text { color: #888 !important; font-size: 12px !important; }
`;

const emptyForm = { sku: "", name: "", unit: "pcs", stock: "0", reorderPoint: "0", cost: "0", supplier: "" };

export default function Materials() {
  const { materials } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state !== "idle";

  const [showModal, setShowModal] = useState(false);
  const [editingMat, setEditingMat] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const sub = (fd) => submit(fd, { method: "post" });
  const f = (k) => (v) => setForm(p => ({ ...p, [k]: v }));

  const totalValue = materials.reduce((s, m) => s + m.stock * m.cost, 0);
  const outOfStock = materials.filter(m => m.stock <= 0).length;
  const lowStock = materials.filter(m => m.stock > 0 && m.stock <= m.reorderPoint).length;

  function openEdit(mat) {
    setEditingMat(mat);
    setForm({ sku: mat.sku, name: mat.name, unit: mat.unit, stock: String(mat.stock), reorderPoint: String(mat.reorderPoint), cost: String(mat.cost), supplier: mat.supplier || "" });
    setShowModal(true);
  }

  function openAdd() {
    setEditingMat(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function handleSave() {
    const fd = new FormData();
    fd.append("intent", editingMat ? "editMaterial" : "addMaterial");
    if (editingMat) fd.append("id", editingMat.id);
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    sub(fd);
    setShowModal(false);
    setEditingMat(null);
  }

  return (
    <Page
      title="Raw Materials"
      primaryAction={{ content: "Add Material", onAction: openAdd }}
    >
      <style>{darkStyles}</style>
      <Layout>
        <Layout.Section>
          <div style={{ display: "flex", gap: "12px", marginBottom: "4px" }}>
            {[
              { label: "TOTAL MATERIALS", value: materials.length, color: "#fff" },
              { label: "OUT OF STOCK", value: outOfStock, color: outOfStock > 0 ? "#ff4444" : "#fff" },
              { label: "LOW STOCK", value: lowStock, color: lowStock > 0 ? "#f0a500" : "#fff" },
              { label: "TOTAL VALUE", value: `$${Number(totalValue).toFixed(2)}`, color: "#fff" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "#0a0a0a", border: "1px solid #1f1f1f", borderRadius: "8px", padding: "16px 20px", flex: 1 }}>
                <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: "#555", marginBottom: "6px" }}>{label}</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            {materials.length === 0 ? (
              <Box padding="800">
                <EmptyState
                  heading="No materials yet"
                  action={{ content: "Add Material", onAction: openAdd }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Add your raw materials to start building BOMs.</p>
                </EmptyState>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "", ""]}
                headings={["SKU", "Material", "Stock Level", "Reorder Pt", "Cost/Unit", "Total Value", "Supplier", "", ""]}
                rows={materials.map(mat => [
                  <Text variant="bodySm" tone="subdued">{mat.sku}</Text>,
                  <Text fontWeight="medium">{mat.name}</Text>,
                  <StockBar mat={mat} />,
                  <Text variant="bodySm" tone="subdued">{mat.reorderPoint} {mat.unit}</Text>,
                  fmt(mat.cost),
                  <Text fontWeight="medium">{fmt(mat.stock * mat.cost)}</Text>,
                  <Text variant="bodySm" tone="subdued">{mat.supplier || "—"}</Text>,
                  <Button size="slim" variant="plain" onClick={() => openEdit(mat)}>Edit</Button>,
                  <Button size="slim" tone="critical" variant="plain" onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "deleteMaterial");
                    fd.append("id", mat.id);
                    sub(fd);
                  }}>Delete</Button>,
                ])}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditingMat(null); }}
        title={editingMat ? `Edit — ${editingMat.name}` : "Add Raw Material"}
        primaryAction={{ content: "Save", onAction: handleSave, loading: isLoading }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <InlineStack gap="300">
              <TextField label="SKU *" value={form.sku} onChange={f("sku")} autoComplete="off" disabled={!!editingMat} />
              <TextField label="Name *" value={form.name} onChange={f("name")} autoComplete="off" />
            </InlineStack>
            <InlineStack gap="300">
              <Select label="Unit" value={form.unit} onChange={f("unit")}
                options={["pcs","meters","kg","g","liters","ml","spools","sheets","rolls"].map(u => ({ label: u, value: u }))} />
              <TextField label="Supplier" value={form.supplier} onChange={f("supplier")} autoComplete="off" />
            </InlineStack>
            <InlineStack gap="300">
              <TextField label="Current Stock" type="number" value={form.stock} onChange={f("stock")} autoComplete="off" />
              <TextField label="Reorder Point" type="number" value={form.reorderPoint} onChange={f("reorderPoint")} autoComplete="off" />
              <TextField label="Cost / Unit ($)" type="number" value={form.cost} onChange={f("cost")} autoComplete="off" />
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
