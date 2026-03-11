import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Modal, TextField, Select,
  EmptyState, Banner, InlineGrid,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [productionRuns, products] = await Promise.all([
    prisma.productionRun.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 100, include: { product: true } }),
    prisma.product.findMany({ where: { shop }, orderBy: { name: "asc" }, include: { bomLines: { include: { material: true, subAssembly: { include: { components: { include: { material: true } } } } } } } }),
  ]);
  return json({ productionRuns, products });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const productId = fd.get("productId");
  const qty = +fd.get("qty");
  const note = fd.get("note") || null;
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { bomLines: { include: { material: true, subAssembly: { include: { components: { include: { material: true } } } } } } } });
  if (!product) return json({ ok: false });
  const totals = {};
  for (const line of product.bomLines) {
    const lineQty = line.qty * qty;
    if (line.material) totals[line.materialId] = { qty: (totals[line.materialId]?.qty || 0) + lineQty, material: line.material };
    else if (line.subAssembly) for (const comp of line.subAssembly.components) {
      totals[comp.materialId] = { qty: (totals[comp.materialId]?.qty || 0) + comp.qty * lineQty, material: comp.material };
    }
  }
  for (const [materialId, entry] of Object.entries(totals)) {
    const current = await prisma.material.findUnique({ where: { id: materialId } });
    if (!current) continue;
    await prisma.material.update({ where: { id: materialId }, data: { stock: Math.max(0, current.stock - entry.qty) } });
    await prisma.stockMovement.create({ data: { shop, materialId, type: "PRODUCTION", qty: -entry.qty, reference: `Production: ${product.name}`, note: note || `${qty}x ${product.name}` } });
  }
  await prisma.productionRun.create({ data: { shop, productId, qty, note } });
  return json({ ok: true });
}

export default function Production() {
  const { productionRuns, products } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state !== "idle";
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ productId: "", qty: "1", note: "" });
  const sub = (fd) => submit(fd, { method: "post" });
  const f = (k) => (v) => setForm(p => ({ ...p, [k]: v }));
  const totalProduced = productionRuns.reduce((s, r) => s + r.qty, 0);

  return (
    <Page title="Production Runs" primaryAction={{ content: "Log Production Run", onAction: () => setShowModal(true), disabled: products.length === 0 }}>
      <Layout>
        <Layout.Section>
          <InlineGrid columns={3} gap="400">
            {[
              { label: "Total Runs", value: productionRuns.length },
              { label: "Units Produced", value: totalProduced },
              { label: "Products", value: products.length },
            ].map(({ label, value }) => (
              <Card key={label}>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">{label}</Text>
                  <Text variant="heading2xl" as="p">{value}</Text>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            {productionRuns.length === 0
              ? <EmptyState heading="No production runs yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png" action={{ content: "Log Production Run", onAction: () => setShowModal(true), disabled: products.length === 0 }}>
                  <p>Log a run when you manufacture a batch. Materials are deducted automatically based on the BOM.</p>
                </EmptyState>
              : <DataTable
                  columnContentTypes={["text","text","text","text"]}
                  headings={["Date","Product","Qty Produced","Note"]}
                  rows={productionRuns.map(r => [
                    <Text variant="bodySm" tone="subdued">{new Date(r.createdAt).toLocaleString()}</Text>,
                    <Text fontWeight="medium">{r.product.name}</Text>,
                    <Badge>{r.qty} units</Badge>,
                    <Text variant="bodySm" tone="subdued">{r.note || "—"}</Text>,
                  ])}
                />
            }
          </Card>
        </Layout.Section>
      </Layout>
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Log Production Run"
        primaryAction={{ content: "Log Run", loading: isLoading, disabled: !form.productId, onAction: () => { const fd = new FormData(); fd.append("productId",form.productId); fd.append("qty",form.qty); fd.append("note",form.note); sub(fd); setShowModal(false); setForm({productId:"",qty:"1",note:""}); }}}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select label="Product" options={[{ label: "Select product...", value: "" }, ...products.map(p => ({ label: p.name, value: p.id }))]} value={form.productId} onChange={f("productId")} />
            <TextField label="Qty to Produce" type="number" value={form.qty} onChange={f("qty")} autoComplete="off" />
            <TextField label="Note (optional)" value={form.note} onChange={f("note")} autoComplete="off" />
            <Banner tone="info" title="Materials will be deducted automatically">Raw materials required by this product's BOM will be deducted from stock.</Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
