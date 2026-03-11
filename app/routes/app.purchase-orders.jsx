import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Modal, TextField, Select,
  EmptyState, Divider, Banner, Box,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [purchaseOrders, materials] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { shop }, orderBy: { createdAt: "desc" },
      include: { lines: { include: { material: true } } },
    }),
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
    const po = await prisma.purchaseOrder.create({
      data: { shop, supplier: fd.get("supplier") || null, note: fd.get("note") || null },
    });
    return json({ ok: true, id: po.id });
  }
  if (intent === "addPOLine") {
    await prisma.purchaseOrderLine.create({
      data: { purchaseOrderId: fd.get("purchaseOrderId"), materialId: fd.get("materialId"), qty: +fd.get("qty"), cost: +fd.get("cost") },
    });
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
    const poId = fd.get("id");
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: { include: { material: true } } },
    });
    if (!po || po.status === "received") return json({ ok: false });

    for (const line of po.lines) {
      await prisma.material.update({ where: { id: line.materialId }, data: { stock: { increment: line.qty } } });
      await prisma.stockMovement.create({
        data: { shop, materialId: line.materialId, type: "PURCHASE", qty: line.qty, reference: `PO: ${po.supplier || "No supplier"}`, note: `Received ${line.qty} ${line.material.unit}` },
      });
    }
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: "received", receivedAt: new Date() } });
    return json({ ok: true });
  }
  return json({ ok: false });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;

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
  .Polaris-TextField__Input { background: #1a1a1a !important; color: #fff !important; }
  .Polaris-TextField__Backdrop { background: #1a1a1a !important; border-color: #2a2a2a !important; }
  .Polaris-Modal-Dialog__Modal { background: #111 !important; border: 1px solid #2a2a2a !important; }
  .Polaris-Modal-Header { border-bottom: 1px solid #1f1f1f !important; }
  .Polaris-Modal-Footer { border-top: 1px solid #1f1f1f !important; }
  .Polaris-Label__Text { color: #888 !important; font-size: 12px !important; }
  .Polaris-EmptyState__Image { opacity: 0.3; filter: invert(1); }
  .sd-po-card { background: #0a0a0a; border: 1px solid #1f1f1f; border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: border-color 0.15s; }
  .sd-po-card:hover { border-color: #444; }
  .sd-po-card.selected { border-color: #fff; }
`;

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
      <style>{darkStyles}</style>
      <Layout>
        <Layout.Section>
          <div style={{ display: "flex", gap: "12px", marginBottom: "4px" }}>
            {[
              { label: "TOTAL POs", value: purchaseOrders.length },
              { label: "DRAFT", value: draftCount, color: draftCount > 0 ? "#f0a500" : "#fff" },
              { label: "TOTAL SPEND", value: fmt(totalSpend) },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "#0a0a0a", border: "1px solid #1f1f1f", borderRadius: "8px", padding: "16px 20px", flex: 1 }}>
                <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: "#555", marginBottom: "6px" }}>{label}</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: color || "#fff" }}>{value}</div>
              </div>
            ))}
          </div>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" fontWeight="bold">Purchase Orders</Text>
              <Divider />
              {purchaseOrders.length === 0 ? (
                <Text tone="subdued" variant="bodySm">No purchase orders yet.</Text>
              ) : (
                <BlockStack gap="200">
                  {purchaseOrders.map(po => {
                    const total = po.lines.reduce((s, l) => s + l.qty * l.cost, 0);
                    return (
                      <div key={po.id} className={`sd-po-card${selectedPO === po.id ? " selected" : ""}`} onClick={() => setSelectedPO(po.id)}>
                        <InlineStack align="space-between">
                          <BlockStack gap="050">
                            <Text fontWeight="semibold">{po.supplier || "No supplier"}</Text>
                            <Text variant="bodySm" tone="subdued">{new Date(po.createdAt).toLocaleDateString()} · {po.lines.length} line(s)</Text>
                          </BlockStack>
                          <BlockStack gap="100" align="end">
                            <Badge tone={po.status === "received" ? "success" : "attention"}>
                              {po.status === "received" ? "Received" : "Draft"}
                            </Badge>
                            <Text variant="bodySm" fontWeight="medium">{fmt(total)}</Text>
                          </BlockStack>
                        </InlineStack>
                      </div>
                    );
                  })}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {selectedPOData ? (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="headingSm" fontWeight="bold">{selectedPOData.supplier || "No supplier"}</Text>
                    <InlineStack gap="200">
                      {selectedPOData.status === "draft" && (
                        <>
                          <Button variant="primary" onClick={() => {
                            const fd = new FormData(); fd.append("intent", "receivePO"); fd.append("id", selectedPOData.id); sub(fd); setSelectedPO(null);
                          }}>Mark as Received</Button>
                          <Button tone="critical" variant="plain" onClick={() => {
                            const fd = new FormData(); fd.append("intent", "deletePO"); fd.append("id", selectedPOData.id); sub(fd); setSelectedPO(null);
                          }}>Delete</Button>
                        </>
                      )}
                    </InlineStack>
                  </InlineStack>
                  {selectedPOData.note && <Text tone="subdued" variant="bodySm">{selectedPOData.note}</Text>}
                  {selectedPOData.status === "received" && (
                    <Banner tone="success" title={`Received on ${new Date(selectedPOData.receivedAt).toLocaleDateString()}`}>
                      Stock has been updated for all lines.
                    </Banner>
                  )}
                  <Divider />
                  {selectedPOData.lines.length === 0 ? (
                    <Text tone="subdued">No lines yet. Add materials below.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "numeric", "text", "numeric", "numeric", ""]}
                      headings={["Material", "Qty", "Unit", "Unit Cost", "Line Total", ""]}
                      rows={selectedPOData.lines.map(l => [
                        l.material.name, l.qty, l.material.unit, fmt(l.cost), fmt(l.qty * l.cost),
                        selectedPOData.status === "draft"
                          ? <Button size="slim" tone="critical" variant="plain" onClick={() => {
                              const fd = new FormData(); fd.append("intent", "deletePOLine"); fd.append("id", l.id); sub(fd);
                            }}>Remove</Button>
                          : null,
                      ])}
                    />
                  )}
                  <Text fontWeight="bold">Total: {fmt(selectedPOData.lines.reduce((s, l) => s + l.qty * l.cost, 0))}</Text>
                </BlockStack>
              </Card>

              {selectedPOData.status === "draft" && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingSm" fontWeight="bold">Add Line</Text>
                    <Divider />
                    <InlineStack gap="300" align="end">
                      <Select label="Material"
                        options={[{ label: "Select...", value: "" }, ...materials.map(m => ({ label: m.name, value: m.id }))]}
                        value={lineForm.materialId} onChange={v => setLineForm(f => ({ ...f, materialId: v }))}
                      />
                      <TextField label="Qty" type="number" value={lineForm.qty} onChange={v => setLineForm(f => ({ ...f, qty: v }))} autoComplete="off" />
                      <TextField label="Unit Cost ($)" type="number" value={lineForm.cost} onChange={v => setLineForm(f => ({ ...f, cost: v }))} autoComplete="off" />
                      <Box paddingBlockStart="500">
                        <Button disabled={!lineForm.materialId} onClick={() => {
                          const fd = new FormData();
                          fd.append("intent", "addPOLine");
                          fd.append("purchaseOrderId", selectedPOData.id);
                          fd.append("materialId", lineForm.materialId);
                          fd.append("qty", lineForm.qty);
                          fd.append("cost", lineForm.cost);
                          sub(fd);
                          setLineForm({ materialId: "", qty: "1", cost: "0" });
                        }}>Add</Button>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          ) : (
            <Card>
              <Box padding="800">
                <Text tone="subdued" alignment="center">← Select a purchase order to manage it</Text>
              </Box>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="New Purchase Order"
        primaryAction={{ content: "Create PO", loading: isLoading, onAction: () => {
          const fd = new FormData();
          fd.append("intent", "createPO");
          fd.append("supplier", poForm.supplier);
          fd.append("note", poForm.note);
          sub(fd);
          setShowCreateModal(false);
          setPoForm({ supplier: "", note: "" });
        }}}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowCreateModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField label="Supplier name" value={poForm.supplier} onChange={v => setPoForm(f => ({ ...f, supplier: v }))} autoComplete="off" />
            <TextField label="Note (optional)" value={poForm.note} onChange={v => setPoForm(f => ({ ...f, note: v }))} autoComplete="off" multiline={2} />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
