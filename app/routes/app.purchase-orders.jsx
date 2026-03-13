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
    prisma.purchaseOrder.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
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
    await prisma.purchaseOrder.create({
      data: { shop, supplier: fd.get("supplier") || null, note: fd.get("note") || null },
    });
    return json({ ok: true });
  }
  if (intent === "addPOLine") {
    await prisma.purchaseOrderLine.create({
      data: {
        purchaseOrderId: fd.get("purchaseOrderId"),
        materialId: fd.get("materialId"),
        qty: +fd.get("qty"),
        cost: +fd.get("cost"),
      },
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
      await prisma.material.update({
        where: { id: line.materialId },
        data: { stock: { increment: line.qty } },
      });
      await prisma.stockMovement.create({
        data: {
          shop,
          materialId: line.materialId,
          type: "PURCHASE",
          qty: line.qty,
          reference: `PO: ${po.supplier || "No supplier"}`,
          note: `Received ${line.qty} ${line.material.unit}`,
        },
      });
    }
    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: "received", receivedAt: new Date() },
    });
    return json({ ok: true });
  }
  return json({ ok: false });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;
const poRef = (po) => `PO-${po.id.slice(-6).toUpperCase()}`;

const emptyPOForm = { supplier: "", note: "" };

export default function PurchaseOrders() {
  const { purchaseOrders, materials } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state !== "idle";

  const [selectedPO, setSelectedPO] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [poForm, setPoForm] = useState(emptyPOForm);
  const [lineForm, setLineForm] = useState({ materialId: "", qty: "1", cost: "0" });

  const sub = (fd) => submit(fd, { method: "post" });
  const pf = (k) => (v) => setPoForm(p => ({ ...p, [k]: v }));

  const selectedPOData = selectedPO ? purchaseOrders.find(p => p.id === selectedPO) : null;
  const draftCount = purchaseOrders.filter(p => p.status === "draft").length;
  const totalSpend = purchaseOrders
    .filter(p => p.status === "received")
    .reduce((s, po) => s + po.lines.reduce((ls, l) => ls + l.qty * l.cost, 0), 0);

  return (
    <Page
      title="Purchase Orders"
      primaryAction={{ content: "New Purchase Order", onAction: () => { setPoForm(emptyPOForm); setShowCreateModal(true); } }}
    >
      <Layout>
        <Layout.Section>
          <InlineGrid columns={3} gap="400">
            {[
              { label: "Total POs", value: purchaseOrders.length },
              { label: "Open / Draft", value: draftCount, tone: draftCount > 0 ? "caution" : undefined },
              { label: "Total Received Value", value: fmt(totalSpend) },
            ].map(({ label, value, tone }) => (
              <Card key={label}>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">{label}</Text>
                  <Text variant="headingXl" as="p" tone={tone}>{value}</Text>
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
              {purchaseOrders.length === 0 ? (
                <Text tone="subdued" variant="bodySm">No purchase orders yet.</Text>
              ) : (
                <BlockStack gap="200">
                  {purchaseOrders.map(po => {
                    const total = po.lines.reduce((s, l) => s + l.qty * l.cost, 0);
                    const isSelected = selectedPO === po.id;
                    return (
                      <Box
                        key={po.id}
                        padding="300"
                        borderWidth="025"
                        borderRadius="200"
                        borderColor={isSelected ? "border-emphasis" : "border"}
                        background={isSelected ? "bg-surface-selected" : "bg-surface"}
                        onClick={() => setSelectedPO(po.id)}
                        style={{ cursor: "pointer" }}
                      >
                        <BlockStack gap="100">
                          <InlineStack align="space-between">
                            <Text fontWeight="bold" variant="bodySm">{poRef(po)}</Text>
                            <Badge tone={po.status === "received" ? "success" : "attention"}>
                              {po.status === "received" ? "Received" : "Draft"}
                            </Badge>
                          </InlineStack>
                          <Text fontWeight="semibold">{po.supplier || "No supplier"}</Text>
                          <InlineStack align="space-between">
                            <Text variant="bodySm" tone="subdued">{new Date(po.createdAt).toLocaleDateString()}</Text>
                            <Text variant="bodySm" fontWeight="medium">{fmt(total)}</Text>
                          </InlineStack>
                        </BlockStack>
                      </Box>
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
              {/* PO Header Card */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="200">
                      <Text variant="headingXl" fontWeight="bold">{poRef(selectedPOData)}</Text>
                      <Badge
                        tone={selectedPOData.status === "received" ? "success" : "attention"}
                        size="large"
                      >
                        {selectedPOData.status === "received" ? "Received" : "Draft"}
                      </Badge>
                    </BlockStack>
                    {selectedPOData.status === "draft" && (
                      <InlineStack gap="200">
                        <Button
                          variant="primary"
                          onClick={() => {
                            const fd = new FormData();
                            fd.append("intent", "receivePO");
                            fd.append("id", selectedPOData.id);
                            sub(fd);
                            setSelectedPO(null);
                          }}
                        >
                          Mark as Received
                        </Button>
                        <Button
                          tone="critical"
                          variant="plain"
                          onClick={() => {
                            const fd = new FormData();
                            fd.append("intent", "deletePO");
                            fd.append("id", selectedPOData.id);
                            sub(fd);
                            setSelectedPO(null);
                          }}
                        >
                          Delete PO
                        </Button>
                      </InlineStack>
                    )}
                  </InlineStack>

                  <Divider />

                  <InlineGrid columns={3} gap="400">
                    <BlockStack gap="050">
                      <Text variant="bodySm" tone="subdued">Supplier</Text>
                      <Text fontWeight="semibold">{selectedPOData.supplier || "—"}</Text>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text variant="bodySm" tone="subdued">Date Created</Text>
                      <Text fontWeight="semibold">{new Date(selectedPOData.createdAt).toLocaleDateString()}</Text>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text variant="bodySm" tone="subdued">
                        {selectedPOData.status === "received" ? "Date Received" : "Status"}
                      </Text>
                      <Text fontWeight="semibold">
                        {selectedPOData.receivedAt
                          ? new Date(selectedPOData.receivedAt).toLocaleDateString()
                          : "Pending"}
                      </Text>
                    </BlockStack>
                  </InlineGrid>

                  {selectedPOData.note && (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="050">
                        <Text variant="bodySm" tone="subdued">Notes</Text>
                        <Text>{selectedPOData.note}</Text>
                      </BlockStack>
                    </Box>
                  )}

                  {selectedPOData.status === "received" && (
                    <Banner tone="success" title="Stock updated successfully">
                      All lines were received and inventory was updated on {new Date(selectedPOData.receivedAt).toLocaleDateString()}.
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              {/* Order Lines */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Order Lines</Text>
                  <Divider />
                  {selectedPOData.lines.length === 0 ? (
                    <Text tone="subdued">No lines added yet. Add materials below.</Text>
                  ) : (
                    <>
                      <DataTable
                        columnContentTypes={["text", "numeric", "text", "numeric", "numeric", ""]}
                        headings={["Material", "Qty", "Unit", "Unit Cost", "Line Total", ""]}
                        rows={selectedPOData.lines.map(l => [
                          <Text fontWeight="medium">{l.material.name}</Text>,
                          l.qty,
                          l.material.unit,
                          fmt(l.cost),
                          <Text fontWeight="semibold">{fmt(l.qty * l.cost)}</Text>,
                          selectedPOData.status === "draft" ? (
                            <Button size="slim" tone="critical" variant="plain" onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "deletePOLine");
                              fd.append("id", l.id);
                              sub(fd);
                            }}>Remove</Button>
                          ) : null,
                        ])}
                      />
                      <InlineStack align="end">
                        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                          <Text variant="headingMd" fontWeight="bold">
                            Order Total: {fmt(selectedPOData.lines.reduce((s, l) => s + l.qty * l.cost, 0))}
                          </Text>
                        </Box>
                      </InlineStack>
                    </>
                  )}
                </BlockStack>
              </Card>

              {/* Add Line */}
              {selectedPOData.status === "draft" && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">Add Line Item</Text>
                    <Divider />
                    <InlineStack gap="300" blockAlign="end" wrap>
                      <Select
                        label="Material"
                        options={[
                          { label: "Select material...", value: "" },
                          ...materials.map(m => ({ label: `${m.name} (${m.sku})`, value: m.id })),
                        ]}
                        value={lineForm.materialId}
                        onChange={v => setLineForm(f => ({ ...f, materialId: v }))}
                      />
                      <TextField label="Qty" type="number" value={lineForm.qty} onChange={v => setLineForm(f => ({ ...f, qty: v }))} autoComplete="off" />
                      <TextField label="Unit Cost ($)" type="number" value={lineForm.cost} onChange={v => setLineForm(f => ({ ...f, cost: v }))} autoComplete="off" />
                      <Box paddingBlockStart="500">
                        <Button
                          disabled={!lineForm.materialId}
                          onClick={() => {
                            const fd = new FormData();
                            fd.append("intent", "addPOLine");
                            fd.append("purchaseOrderId", selectedPOData.id);
                            fd.append("materialId", lineForm.materialId);
                            fd.append("qty", lineForm.qty);
                            fd.append("cost", lineForm.cost);
                            sub(fd);
                            setLineForm({ materialId: "", qty: "1", cost: "0" });
                          }}
                        >
                          Add Line
                        </Button>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          ) : (
            <Card>
              <Box padding="800">
                <EmptyState
                  heading="Select a purchase order"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{ content: "New Purchase Order", onAction: () => { setPoForm(emptyPOForm); setShowCreateModal(true); } }}
                >
                  <p>Select a PO from the list to view its details, add line items, and mark it as received when stock arrives.</p>
                </EmptyState>
              </Box>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="New Purchase Order"
        primaryAction={{
          content: "Create Purchase Order",
          loading: isLoading,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", "createPO");
            fd.append("supplier", poForm.supplier);
            fd.append("note", poForm.note);
            sub(fd);
            setShowCreateModal(false);
            setPoForm(emptyPOForm);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowCreateModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Supplier Name"
              value={poForm.supplier}
              onChange={pf("supplier")}
              autoComplete="off"
              placeholder="e.g. Acme Supplies Ltd"
            />
            <TextField
              label="Notes (optional)"
              value={poForm.note}
              onChange={pf("note")}
              autoComplete="off"
              multiline={2}
              placeholder="e.g. Urgent order, deliver to warehouse B"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
