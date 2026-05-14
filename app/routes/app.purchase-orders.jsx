import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Modal, TextField, Select,
  EmptyState, Divider, Banner, Box, InlineGrid,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";
import { createXeroBill } from "../xero.server";
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
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "createPO") {
    // 1. Create PO in our database
    const po = await prisma.purchaseOrder.create({
      data: { shop, supplier: fd.get("supplier") || null, note: fd.get("note") || null },
    });

    // 2. Create a Draft Order in Shopify
    try {
      const response = await admin.graphql(`
        mutation draftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder { id }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          input: {
            note: `SupplyDesk PO | Supplier: ${fd.get("supplier") || "Unknown"} | ${new Date().toLocaleDateString()}`,
            tags: ["supplydesk-po", `po-${po.id.slice(-6).toUpperCase()}`],
            lineItems: [
              {
                title: `Purchase Order — ${fd.get("supplier") || "Unknown supplier"}`,
                quantity: 1,
                originalUnitPrice: "0.00",
              },
            ],
          },
        },
      });
      const data = await response.json();
      const draftOrderId = data?.data?.draftOrderCreate?.draftOrder?.id;
      if (draftOrderId) {
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { shopifyDraftOrderId: draftOrderId },
        });
      }
    } catch (err) {
      console.error("[SupplyDesk] Failed to create Shopify Draft Order:", err);
    }

    return json({ ok: true });
  }

  if (intent === "addPOLine") {
    // Add line to our DB
    await prisma.purchaseOrderLine.create({
      data: {
        purchaseOrderId: fd.get("purchaseOrderId"),
        materialId: fd.get("materialId"),
        qty: +fd.get("qty"),
        cost: +fd.get("cost"),
      },
    });

    // Rebuild Draft Order lines in Shopify to reflect all current lines
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: fd.get("purchaseOrderId") },
      include: { lines: { include: { material: true } } },
    });

    if (po?.shopifyDraftOrderId) {
      try {
        await admin.graphql(`
          mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
            draftOrderUpdate(id: $id, input: $input) {
              draftOrder { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            id: po.shopifyDraftOrderId,
            input: {
              lineItems: po.lines.map(l => ({
                title: l.material.name,
                sku: l.material.sku,
                quantity: Math.max(1, Math.round(l.qty)),
                originalUnitPrice: String(l.cost.toFixed(2)),
              })),
            },
          },
        });
      } catch (err) {
        console.error("[SupplyDesk] Failed to update Shopify Draft Order lines:", err);
      }
    }

    return json({ ok: true });
  }

  if (intent === "deletePOLine") {
    await prisma.purchaseOrderLine.delete({ where: { id: fd.get("id") } });

    // Rebuild Draft Order lines after deletion
    const poId = fd.get("purchaseOrderId");
    if (poId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: { lines: { include: { material: true } } },
      });
      if (po?.shopifyDraftOrderId) {
        try {
          await admin.graphql(`
            mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
              draftOrderUpdate(id: $id, input: $input) {
                draftOrder { id }
                userErrors { field message }
              }
            }
          `, {
            variables: {
              id: po.shopifyDraftOrderId,
              input: {
                lineItems: po.lines.length > 0
                  ? po.lines.map(l => ({
                      title: l.material.name,
                      sku: l.material.sku,
                      quantity: Math.max(1, Math.round(l.qty)),
                      originalUnitPrice: String(l.cost.toFixed(2)),
                    }))
                  : [{ title: "No lines yet", quantity: 1, originalUnitPrice: "0.00" }],
              },
            },
          });
        } catch (err) {
          console.error("[SupplyDesk] Failed to update Shopify Draft Order after line delete:", err);
        }
      }
    }

    return json({ ok: true });
  }

  if (intent === "deletePO") {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: fd.get("id") } });

    // Delete Draft Order in Shopify
    if (po?.shopifyDraftOrderId) {
      try {
        await admin.graphql(`
          mutation draftOrderDelete($input: DraftOrderDeleteInput!) {
            draftOrderDelete(input: $input) {
              deletedId
              userErrors { field message }
            }
          }
        `, {
          variables: { input: { id: po.shopifyDraftOrderId } },
        });
      } catch (err) {
        console.error("[SupplyDesk] Failed to delete Shopify Draft Order:", err);
      }
    }

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

    // 1. Update stock in our DB and log movements
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
    // 3. Sync to Xero as a Bill
    try {
      await createXeroBill(shop, {
        ...po,
        lines: po.lines.map((l) => ({
          materialName: l.material?.name,
          sku: l.material?.sku,
          quantity: l.qty,
          unitCost: l.cost,
        })),
      });
    } catch (xeroErr) {
      console.error("[SupplyDesk] Xero sync failed:", xeroErr);
      // Don't fail the PO receive if Xero is not connected or fails
    }
    // 2. Complete the Draft Order in Shopify so it syncs to Xero via A2X
    if (po.shopifyDraftOrderId) {
      try {
        await admin.graphql(`
          mutation draftOrderComplete($id: ID!) {
            draftOrderComplete(id: $id) {
              draftOrder { id status }
              userErrors { field message }
            }
          }
        `, {
          variables: { id: po.shopifyDraftOrderId },
        });
      } catch (err) {
        console.error("[SupplyDesk] Failed to complete Shopify Draft Order:", err);
      }
    }

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
                          {po.shopifyDraftOrderId && (
                            <Badge tone="info" size="small">Synced to Shopify</Badge>
                          )}
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
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="200">
                      <Text variant="headingXl" fontWeight="bold">{poRef(selectedPOData)}</Text>
                      <InlineStack gap="200">
                        <Badge tone={selectedPOData.status === "received" ? "success" : "attention"} size="large">
                          {selectedPOData.status === "received" ? "Received" : "Draft"}
                        </Badge>
                        {selectedPOData.shopifyDraftOrderId && (
                          <Badge tone="info">Synced to Shopify</Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button onClick={() => window.open(`/app/purchase-orders/${selectedPOData.id}/print`, "_blank")}>
                        Download PDF
                      </Button>
                      {selectedPOData.status === "draft" && (
                        <>
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
                        </>
                      )}
                    </InlineStack>
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
                    <Banner tone="success" title="Stock updated and Shopify Draft Order completed">
                      All lines were received, inventory was updated, and the Draft Order in Shopify has been marked as complete for Xero sync via A2X.
                    </Banner>
                  )}
                </BlockStack>
              </Card>

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
                              fd.append("purchaseOrderId", selectedPOData.id);
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
                  <p>Each PO automatically creates a Draft Order in Shopify with individual line items, ready to sync to Xero via A2X.</p>
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
            <Banner tone="info" title="This will also create a Draft Order in Shopify">
              Each PO will appear in your Shopify Draft Orders with individual line items and sync to Xero via A2X. Marking it as received will complete the Draft Order automatically.
            </Banner>
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
