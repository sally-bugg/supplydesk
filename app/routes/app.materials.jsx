import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Modal, TextField, Select,
  EmptyState, InlineGrid, ProgressBar, Box,
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
    <Page title="Raw Materials" primaryAction={{ content: "Add Material", onAction: () => { setEditingMat(null); setForm(emptyForm); setShowModal(true); } }}>
      <Layout>
        <Layout.Section>
          <InlineGrid columns={4} gap="400">
            {[
              { label: "Total Materials", value: materials.length },
              { label: "Out of Stock", value: outOfStock, tone: outOfStock > 0 ? "critical" : undefined },
              { label: "Low Stock", value: lowStock, tone: lowStock > 0 ? "caution" : undefined },
              { label: "Total Value", value: fmt(totalValue) },
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
            {materials.length === 0
              ? <Box padding="800">
                  <EmptyState heading="No materials yet" action={{ content: "Add Material", onAction: () => setShowModal(true) }} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                    <p>Add your raw materials to start building Bills of Materials.</p>
                  </EmptyState>
                </Box>
              : <DataTable
                  columnContentTypes={["text","text","text","text","text","text","text","",""]}
                  headings={["SKU","Material","Stock","Reorder Pt","Cost/Unit","Total Value","Supplier","",""]}
                  rows={materials.map(mat => {
                    const status = stockStatus(mat);
                    const pct = mat.reorderPoint > 0 ? Math.min(100, (mat.stock / (mat.reorderPoint * 2)) * 100) : mat.stock > 0 ? 100 : 0;
                    return [
                      <Text variant="bodySm" tone="subdued">{mat.sku}</Text>,
                      <Text fontWeight="medium">{mat.name}</Text>,
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone={status === "critical" ? "critical" : status === "warning" ? "caution" : undefined}>{mat.stock} {mat.unit}</Text>
                        <ProgressBar progress={pct} tone={status === "critical" ? "critical" : status === "warning" ? "caution" : "success"} size="small" />
                      </BlockStack>,
                      <Text variant="bodySm">{mat.reorderPoint} {mat.unit}</Text>,
                      fmt(mat.cost),
                      <Text fontWeight="medium">{fmt(mat.stock * mat.cost)}</Text>,
                      <Text variant="bodySm" tone="subdued">{mat.supplier || "—"}</Text>,
                      <Button size="slim" variant="plain" onClick={() => openEdit(mat)}>Edit</Button>,
                      <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deleteMaterial"); fd.append("id",mat.id); sub(fd); }}>Delete</Button>,
                    ];
                  })}
                />
            }
          </Card>
        </Layout.Section>
      </Layout>

      <Modal open={showModal} onClose={() => { setShowModal(false); setEditingMat(null); }}
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
              <Select label="Unit" value={form.unit} onChange={f("unit")} options={["pcs","meters","kg","g","liters","ml","spools","sheets","rolls"].map(u=>({label:u,value:u}))} />
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
