import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Modal, TextField, Select,
  EmptyState, Divider, Banner, Box, InlineGrid,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [purchaseOrders, materials] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, include: { lines: { include: { material: true } } } }),
    prisma.material.findMany({ where: { shop }, orderBy: { name: "asc" } }),
  ]);
  return json({ purchaseOrders, materials });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "createPO") {
    await prisma.purchaseOrder.create({ data: { shop, supplier: fd.get("supplier") || null, note: fd.get("note") || null } });
    return json({ ok: true });
  }
  if (intent === "addPOLine") {
    await prisma.purchaseOrderLine.create({ data: { purchaseOrderId: fd.get("purchaseOrderId"), materialId: fd.get("materialId"), qty: +fd.get("qty"), cost: +fd.get("cost") } });
    return json({ ok: true });
  }
  if (intent === "deletePOLine") {
    await prisma.purchaseOrderLine.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }
  if (intent === "deletePO") {
    await prisma.purchaseOrder.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }
  if (intent === "receivePO") {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: fd.get("id") }, include: { lines: { include: { material: true } } } });
    if (!po || po.status === "received") return json({ ok: false });
    for (const line of po.lines) {
      await prisma.material.update({ where: { id: line.materialId }, data: { stock: { increment: line.qty } } });
      await prisma.stockMovement.create({ data: { shop, materialId: line.materialId, type: "PURCHASE", qty: line.qty, reference: `PO: ${po.supplier || "No supplier"}`, note: `Received ${line.qty} ${line.material.unit}` } });
    }
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "received", receivedAt: new Date() } });
    return json({ ok: true });
  }
  return json({ ok: false });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;

export default function PurchaseOrders() {
  const { purchaseOrders, materials } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state !== "idle";
  const [selectedPO, setSelectedPO] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [poForm, setPoForm] = useState({ supplier: "", note: "" });
  const [lineForm, setLineForm] = useState({ materialId: "", qty: "1", cost: "0" });
  const sub = (fd) => submit(fd, { method: "post" });
  const selectedPOData = selectedPO ? purchaseOrders.find(p => p.id === selectedPO) : null;
  const draftCount = purchaseOrders.filter(p => p.status === "draft").length;
  const totalSpend = purchaseOrders.filter(p => p.status === "received").reduce((s, po) => s + po.lines.reduce((ls, l) => ls + l.qty * l.cost, 0), 0);

  return (
    <Page title="Purchase Orders" primaryAction={{ content: "New Purchase Order", onAction: () => setShowCreateModal(true) }}>
      <Layout>
        <Layout.Section>
          <InlineGrid columns={3} gap="400">
            {[
              { label: "Total POs", value: purchaseOrders.length },
              { label: "Draft", value: draftCount, tone: draftCount > 0 ? "caution" : undefined },
              { label: "Total Spend", value: fmt(totalSpend) },
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

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Purchase Orders</Text>
              <Divider />
              {purchaseOrders.length === 0
                ? <Text tone="subdued" variant="bodySm">No purchase orders yet.</Text>
                : <BlockStack gap="200">
                    {purchaseOrders.map(po => {
                      const total = po.lines.reduce((s, l) => s + l.qty * l.cost, 0);
                      return (
                        <Box key={po.id} padding="300" borderWidth="025" borderRadius="200" borderColor={selectedPO === po.id ? "border-emphasis" : "border"} background={selectedPO === po.id ? "bg-surface-selected" : "bg-surface"} onClick={() => setSelectedPO(po.id)} style={{ cursor: "pointer" }}>
                          <InlineStack align="space-between">
                            <BlockStack gap="050">
                              <Text fontWeight="semibold">{po.supplier || "No supplier"}</Text>
                              <Text variant="bodySm" tone="subdued">{new Date(po.createdAt).toLocaleDateString()} · {po.lines.length} line(s)</Text>
                            </BlockStack>
                            <BlockStack gap="100" align="end">
                              <Badge tone={po.status === "received" ? "success" : "attention"}>{po.status === "received" ? "Received" : "Draft"}</Badge>
                              <Text variant="bodySm" fontWeight="medium">{fmt(total)}</Text>
                            </BlockStack>
                          </InlineStack>
                        </Box>
                      );
                    })}
                  </BlockStack>
              }
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {selectedPOData ? (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="headingMd" as="h2">{selectedPOData.supplier || "No supplier"}</Text>
                    <InlineStack gap="200">
                      {selectedPOData.status === "draft" && <>
                        <Button variant="primary" onClick={() => { const fd = new FormData(); fd.append("intent","receivePO"); fd.append("id",selectedPOData.id); sub(fd); setSelectedPO(null); }}>Mark as Received</Button>
                        <Button tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deletePO"); fd.append("id",selectedPOData.id); sub(fd); setSelectedPO(null); }}>Delete</Button>
                      </>}
                    </InlineStack>
                  </InlineStack>
                  {selectedPOData.note && <Text tone="subdued" variant="bodySm">{selectedPOData.note}</Text>}
                  {selectedPOData.status === "received" && <Banner tone="success" title={`Received on ${new Date(selectedPOData.receivedAt).toLocaleDateString()}`}>Stock has been updated for all lines.</Banner>}
                  <Divider />
                  {selectedPOData.lines.length === 0
                    ? <Text tone="subdued">No lines yet.</Text>
                    : <DataTable
                        columnContentTypes={["text","numeric","text","numeric","numeric",""]}
                        headings={["Material","Qty","Unit","Unit Cost","Line Total",""]}
                        rows={selectedPOData.lines.map(l => [
                          l.material.name, l.qty, l.material.unit, fmt(l.cost), fmt(l.qty * l.cost),
                          selectedPOData.status === "draft" ? <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deletePOLine"); fd.append("id",l.id); sub(fd); }}>Remove</Button> : null,
                        ])}
                      />
                  }
                  <Text fontWeight="bold">Total: {fmt(selectedPOData.lines.reduce((s,l) => s + l.qty * l.cost, 0))}</Text>
                </BlockStack>
              </Card>
              {selectedPOData.status === "draft" && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">Add Line</Text>
                    <Divider />
                    <InlineStack gap="300" align="end">
                      <Select label="Material" options={[{ label: "Select...", value: "" }, ...materials.map(m => ({ label: m.name, value: m.id }))]} value={lineForm.materialId} onChange={v => setLineForm(f=>({...f,materialId:v}))} />
                      <TextField label="Qty" type="number" value={lineForm.qty} onChange={v => setLineForm(f=>({...f,qty:v}))} autoComplete="off" />
                      <TextField label="Unit Cost ($)" type="number" value={lineForm.cost} onChange={v => setLineForm(f=>({...f,cost:v}))} autoComplete="off" />
                      <Box paddingBlockStart="500">
                        <Button disabled={!lineForm.materialId} onClick={() => { const fd = new FormData(); fd.append("intent","addPOLine"); fd.append("purchaseOrderId",selectedPOData.id); fd.append("materialId",lineForm.materialId); fd.append("qty",lineForm.qty); fd.append("cost",lineForm.cost); sub(fd); setLineForm({materialId:"",qty:"1",cost:"0"}); }}>Add</Button>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          ) : (
            <Card>
              <Box padding="800">
                <EmptyState heading="Select a purchase order" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Select a purchase order on the left to manage it.</p>
                </EmptyState>
              </Box>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="New Purchase Order"
        primaryAction={{ content: "Create PO", loading: isLoading, onAction: () => { const fd = new FormData(); fd.append("intent","createPO"); fd.append("supplier",poForm.supplier); fd.append("note",poForm.note); sub(fd); setShowCreateModal(false); setPoForm({supplier:"",note:""}); }}}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowCreateModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField label="Supplier name" value={poForm.supplier} onChange={v => setPoForm(f=>({...f,supplier:v}))} autoComplete="off" />
            <TextField label="Note (optional)" value={poForm.note} onChange={v => setPoForm(f=>({...f,note:v}))} autoComplete="off" multiline={2} />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
