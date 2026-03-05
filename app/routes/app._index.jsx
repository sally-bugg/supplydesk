import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Box, Modal, TextField, Select,
  Banner, Tabs, EmptyState, Divider,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

// ─── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [materials, subAssemblies, products, movements, productionRuns, purchaseOrders] = await Promise.all([
    prisma.material.findMany({ where: { shop }, orderBy: { name: "asc" } }),
    prisma.subAssembly.findMany({
      where: { shop },
      include: { components: { include: { material: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { shop },
      include: {
        bomLines: {
          include: {
            material: true,
            subAssembly: { include: { components: { include: { material: true } } } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.stockMovement.findMany({
      where: { shop },
      include: { material: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.productionRun.findMany({
      where: { shop },
      include: { product: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.purchaseOrder.findMany({
      where: { shop },
      include: { lines: { include: { material: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return json({ materials, subAssemblies, products, movements, productionRuns, purchaseOrders });
}

// ─── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");

  // ── Materials ──
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
      data: {
        name: fd.get("name"),
        unit: fd.get("unit"),
        stock: +fd.get("stock"),
        reorderPoint: +fd.get("reorderPoint"),
        cost: +fd.get("cost"),
        supplier: fd.get("supplier") || null,
      },
    });
    return json({ ok: true });
  }
  if (intent === "deleteMaterial") {
    await prisma.material.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }

  // ── Sub-Assemblies ──
  if (intent === "addSubAssembly") {
    const sku = fd.get("sku");
    await prisma.subAssembly.upsert({
      where: { shop_sku: { shop, sku } },
      update: { name: fd.get("name"), unit: fd.get("unit"), description: fd.get("description") || null },
      create: { shop, sku, name: fd.get("name"), unit: fd.get("unit"), description: fd.get("description") || null },
    });
    return json({ ok: true });
  }
  if (intent === "deleteSubAssembly") {
    await prisma.subAssembly.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }
  if (intent === "addSubAsmLine") {
    const subAssemblyId = fd.get("subAssemblyId");
    const materialId = fd.get("materialId");
    await prisma.subAsmLine.upsert({
      where: { subAssemblyId_materialId: { subAssemblyId, materialId } },
      update: { qty: +fd.get("qty") },
      create: { subAssemblyId, materialId, qty: +fd.get("qty") },
    });
    return json({ ok: true });
  }
  if (intent === "deleteSubAsmLine") {
    await prisma.subAsmLine.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }

  // ── Products / Shopify ──
  if (intent === "syncShopify") {
    const response = await admin.graphql(`query { products(first: 100) { edges { node { id title variants(first: 1) { edges { node { sku } } } } } } }`);
    const data = await response.json();
    const shopifyProducts = data.data.products.edges.map(e => ({
      shopifyId: e.node.id,
      name: e.node.title,
      sku: e.node.variants.edges[0]?.node.sku || e.node.id.split("/").pop(),
    }));
    for (const p of shopifyProducts) {
      await prisma.product.upsert({
        where: { shop_shopifyId: { shop, shopifyId: p.shopifyId } },
        update: { name: p.name, sku: p.sku },
        create: { shop, ...p },
      });
    }
    return json({ ok: true, synced: shopifyProducts.length });
  }

  // ── BOM Lines ──
  if (intent === "addBomLineMaterial") {
    await prisma.bomLine.create({
      data: { productId: fd.get("productId"), materialId: fd.get("materialId"), qty: +fd.get("qty") },
    });
    return json({ ok: true });
  }
  if (intent === "addBomLineSubAsm") {
    await prisma.bomLine.create({
      data: { productId: fd.get("productId"), subAssemblyId: fd.get("subAssemblyId"), qty: +fd.get("qty") },
    });
    return json({ ok: true });
  }
  if (intent === "deleteBomLine") {
    await prisma.bomLine.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }

  // ── Production Runs ──
  if (intent === "addProductionRun") {
    const productId = fd.get("productId");
    const qty = +fd.get("qty");
    const note = fd.get("note") || null;

    // Fetch product BOM to deduct materials
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        bomLines: {
          include: {
            material: true,
            subAssembly: { include: { components: { include: { material: true } } } },
          },
        },
      },
    });
    if (!product) return json({ ok: false });

    // Flatten BOM
    const totals = {};
    for (const line of product.bomLines) {
      const lineQty = line.qty * qty;
      if (line.material) {
        totals[line.materialId] = { qty: (totals[line.materialId]?.qty || 0) + lineQty, material: line.material };
      } else if (line.subAssembly) {
        for (const comp of line.subAssembly.components) {
          const compQty = comp.qty * lineQty;
          totals[comp.materialId] = { qty: (totals[comp.materialId]?.qty || 0) + compQty, material: comp.material };
        }
      }
    }

    // Deduct materials
    for (const [materialId, entry] of Object.entries(totals)) {
      const current = await prisma.material.findUnique({ where: { id: materialId } });
      if (!current) continue;
      await prisma.material.update({
        where: { id: materialId },
        data: { stock: Math.max(0, current.stock - entry.qty) },
      });
      await prisma.stockMovement.create({
        data: { shop, materialId, type: "PRODUCTION", qty: -entry.qty, reference: `Production: ${product.name}`, note: note || `${qty}x ${product.name}` },
      });
    }

    await prisma.productionRun.create({
      data: { shop, productId, qty, note },
    });

    return json({ ok: true });
  }

  // ── Purchase Orders ──
  if (intent === "createPO") {
    const po = await prisma.purchaseOrder.create({
      data: { shop, supplier: fd.get("supplier") || null, note: fd.get("note") || null },
    });
    return json({ ok: true, id: po.id });
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) => `$${Number(n).toFixed(2)}`;

function stockStatus(mat) {
  if (mat.stock <= 0) return "critical";
  if (mat.stock <= mat.reorderPoint) return "warning";
  return "success";
}
function stockBadge(mat) {
  const s = stockStatus(mat);
  return <Badge tone={{ critical: "critical", warning: "warning", success: "success" }[s]}>
    {{ critical: "Out of Stock", warning: "Low Stock", success: "In Stock" }[s]}
  </Badge>;
}

function flattenForDisplay(product) {
  const map = {};
  for (const line of product.bomLines) {
    if (line.material) {
      const key = line.materialId;
      map[key] = map[key] || { id: line.materialId, name: line.material.name, unit: line.material.unit, cost: line.material.cost, qty: 0, via: null };
      map[key].qty += line.qty;
    } else if (line.subAssembly) {
      for (const comp of line.subAssembly.components) {
        const key = comp.materialId;
        map[key] = map[key] || { id: comp.materialId, name: comp.material.name, unit: comp.material.unit, cost: comp.material.cost, qty: 0, via: line.subAssembly.name };
        map[key].qty += comp.qty * line.qty;
      }
    }
  }
  return Object.values(map);
}

function getSubAsmCost(sub) {
  return sub.components.reduce((s, c) => s + c.material.cost * c.qty, 0);
}

function getProductCOGS(product) {
  return flattenForDisplay(product).reduce((s, r) => s + r.cost * r.qty, 0);
}

function getMaxProducible(product) {
  const flat = flattenForDisplay(product);
  if (!flat.length) return null;

  const stockMap = {};
  for (const line of product.bomLines) {
    if (line.material) stockMap[line.material.id] = line.material.stock;
    if (line.subAssembly) {
      for (const c of line.subAssembly.components) {
        stockMap[c.material.id] = c.material.stock;
      }
    }
  }

  return Math.floor(
    Math.min(...flat.map(r => {
      const stock = stockMap[r.id] ?? 0;
      return r.qty > 0 ? stock / r.qty : Infinity;
    }))
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SupplyDesk() {
  const { materials, subAssemblies, products, movements, productionRuns, purchaseOrders } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const [selectedTab, setSelectedTab] = useState(0);

  // Modals
  const [showAddMat, setShowAddMat] = useState(false);
  const [editingMat, setEditingMat] = useState(null); // material being edited
  const [showAddSub, setShowAddSub] = useState(false);
  const [showAddProduction, setShowAddProduction] = useState(false);
  const [showCreatePO, setShowCreatePO] = useState(false);

  // Selected items
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSubAsm, setSelectedSubAsm] = useState(null);
  const [selectedPO, setSelectedPO] = useState(null);

  // Forms
  const [matForm, setMatForm] = useState({ sku: "", name: "", unit: "pcs", stock: "0", reorderPoint: "0", cost: "0", supplier: "" });
  const [subForm, setSubForm] = useState({ sku: "", name: "", unit: "pcs", description: "" });
  const [bomMatForm, setBomMatForm] = useState({ materialId: "", qty: "1" });
  const [bomSubForm, setBomSubForm] = useState({ subAssemblyId: "", qty: "1" });
  const [subLineForm, setSubLineForm] = useState({ materialId: "", qty: "1" });
  const [productionForm, setProductionForm] = useState({ productId: "", qty: "1", note: "" });
  const [poForm, setPoForm] = useState({ supplier: "", note: "" });
  const [poLineForm, setPoLineForm] = useState({ materialId: "", qty: "1", cost: "0" });

  const criticalCount = materials.filter(m => stockStatus(m) === "critical").length;
  const lowCount = materials.filter(m => stockStatus(m) === "warning").length;
  const totalValue = materials.reduce((s, m) => s + m.stock * m.cost, 0);

  const sub = (fd) => submit(fd, { method: "post" });

  const tabs = [
    { id: "materials", content: `Materials${lowCount + criticalCount > 0 ? ` (${lowCount + criticalCount} alerts)` : ""}` },
    { id: "subassemblies", content: `Sub-Assemblies (${subAssemblies.length})` },
    { id: "bom", content: "Products & BOM" },
    { id: "production", content: `Production Runs` },
    { id: "purchase", content: `Purchase Orders` },
    { id: "log", content: `Stock Log` },
  ];

  const selectedProductData = selectedProduct ? products.find(p => p.id === selectedProduct.id) : null;
  const selectedSubAsmData = selectedSubAsm ? subAssemblies.find(s => s.id === selectedSubAsm.id) : null;
  const selectedPOData = selectedPO ? purchaseOrders.find(p => p.id === selectedPO.id) : null;

  function openEditMat(mat) {
    setEditingMat(mat);
    setMatForm({ sku: mat.sku, name: mat.name, unit: mat.unit, stock: String(mat.stock), reorderPoint: String(mat.reorderPoint), cost: String(mat.cost), supplier: mat.supplier || "" });
  }

  return (
    <Page
      title="SupplyDesk"
      subtitle="Inventory · Sub-Assemblies · Multi-level BOM"
      primaryAction={{ content: "Sync Shopify Products", onAction: () => { const fd = new FormData(); fd.append("intent", "syncShopify"); sub(fd); }, loading: isLoading }}
    >
      {/* Summary strip */}
      <Layout>
        <Layout.Section>
          <InlineStack gap="400">
            {[
              { label: "Materials", value: materials.length },
              { label: "Sub-Assemblies", value: subAssemblies.length },
              { label: "Stock Alerts", value: criticalCount + lowCount, tone: criticalCount > 0 ? "critical" : undefined },
              { label: "Stock Value", value: fmt(totalValue) },
            ].map(({ label, value, tone }) => (
              <Card key={label}>
                <BlockStack gap="100">
                  <Text variant="headingLg" fontWeight="bold" tone={tone}>{value}</Text>
                  <Text variant="bodySm" tone="subdued">{label}</Text>
                </BlockStack>
              </Card>
            ))}
          </InlineStack>
        </Layout.Section>

        {(criticalCount > 0 || lowCount > 0) && (
          <Layout.Section>
            <Banner tone="warning" title="Stock alerts">
              {criticalCount > 0 && <p>{criticalCount} material(s) out of stock.</p>}
              {lowCount > 0 && <p>{lowCount} material(s) below reorder point.</p>}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="400">

                {/* ══════════ MATERIALS TAB ══════════ */}
                {selectedTab === 0 && (
                  <BlockStack gap="400">
                    <InlineStack align="end">
                      <Button variant="primary" onClick={() => { setEditingMat(null); setMatForm({ sku: "", name: "", unit: "pcs", stock: "0", reorderPoint: "0", cost: "0", supplier: "" }); setShowAddMat(true); }}>Add Material</Button>
                    </InlineStack>
                    {materials.length === 0
                      ? <EmptyState heading="No materials yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"><p>Add raw materials to get started.</p></EmptyState>
                      : <DataTable
                          columnContentTypes={["text","text","numeric","numeric","numeric","numeric","text","text","",""]}
                          headings={["SKU","Material","Stock","Reorder Pt","Cost/Unit","Total Value","Supplier","Status","",""]}
                          rows={materials.map(mat => [
                            <Text tone="subdued" variant="bodySm">{mat.sku}</Text>,
                            mat.name,
                            <Text tone={stockStatus(mat) === "critical" ? "critical" : stockStatus(mat) === "warning" ? "caution" : undefined}>{mat.stock} {mat.unit}</Text>,
                            mat.reorderPoint,
                            fmt(mat.cost),
                            fmt(mat.stock * mat.cost),
                            mat.supplier || "—",
                            stockBadge(mat),
                            <Button size="slim" variant="plain" onClick={() => { openEditMat(mat); setShowAddMat(true); }}>Edit</Button>,
                            <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deleteMaterial"); fd.append("id",mat.id); sub(fd); }}>Delete</Button>,
                          ])}
                        />
                    }
                  </BlockStack>
                )}

                {/* ══════════ SUB-ASSEMBLIES TAB ══════════ */}
                {selectedTab === 1 && (
                  <Layout>
                    <Layout.Section variant="oneThird">
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text variant="headingSm">Sub-Assemblies</Text>
                          <Button size="slim" onClick={() => setShowAddSub(true)}>+ New</Button>
                        </InlineStack>
                        <Text tone="subdued" variant="bodySm">
                          Sub-assemblies are intermediate manufactured parts made from raw materials.
                        </Text>
                        <Divider />
                        {subAssemblies.length === 0
                          ? <Text tone="subdued">No sub-assemblies yet.</Text>
                          : subAssemblies.map(s => {
                              const isSelected = selectedSubAsm?.id === s.id;
                              return (
                                <Box key={s.id} padding="300" borderWidth="025" borderRadius="200"
                                  borderColor={isSelected ? "border-emphasis" : "border"}
                                  background={isSelected ? "bg-surface-selected" : "bg-surface"}
                                  onClick={() => setSelectedSubAsm(s)} style={{ cursor: "pointer" }}>
                                  <InlineStack align="space-between">
                                    <BlockStack gap="050">
                                      <Text fontWeight="medium">{s.name}</Text>
                                      <Text variant="bodySm" tone="subdued">{s.sku} · {s.components.length} component(s)</Text>
                                    </BlockStack>
                                    <BlockStack gap="050" align="end">
                                      <Badge tone="info">{fmt(getSubAsmCost(s))} / {s.unit}</Badge>
                                      <Button size="slim" tone="critical" variant="plain" onClick={(e) => { e.stopPropagation(); const fd = new FormData(); fd.append("intent","deleteSubAssembly"); fd.append("id",s.id); sub(fd); }}>Delete</Button>
                                    </BlockStack>
                                  </InlineStack>
                                </Box>
                              );
                            })
                        }
                      </BlockStack>
                    </Layout.Section>

                    <Layout.Section>
                      {selectedSubAsmData ? (
                        <BlockStack gap="400">
                          <Text variant="headingSm">Components — {selectedSubAsmData.name}</Text>
                          {selectedSubAsmData.description && <Text tone="subdued">{selectedSubAsmData.description}</Text>}
                          {selectedSubAsmData.components.length === 0
                            ? <Text tone="subdued">No components yet.</Text>
                            : <DataTable
                                columnContentTypes={["text","numeric","text","numeric",""]}
                                headings={["Raw Material","Qty","Unit","Line Cost",""]}
                                rows={selectedSubAsmData.components.map(c => [
                                  c.material.name, c.qty, c.material.unit, fmt(c.material.cost * c.qty),
                                  <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deleteSubAsmLine"); fd.append("id",c.id); sub(fd); }}>Remove</Button>,
                                ])}
                              />
                          }
                          <Text>Total cost per {selectedSubAsmData.unit}: <Text as="span" fontWeight="bold">{fmt(getSubAsmCost(selectedSubAsmData))}</Text></Text>
                          <Card>
                            <BlockStack gap="300">
                              <Text variant="headingSm">Add Component</Text>
                              <InlineStack gap="300" align="end">
                                <Select label="Raw Material"
                                  options={[{ label: "Select...", value: "" }, ...materials.map(m => ({ label: m.name, value: m.id }))]}
                                  value={subLineForm.materialId}
                                  onChange={v => setSubLineForm(f => ({ ...f, materialId: v }))}
                                />
                                <TextField label="Qty" type="number" value={subLineForm.qty} onChange={v => setSubLineForm(f => ({ ...f, qty: v }))} autoComplete="off" />
                                <Box paddingBlockStart="500">
                                  <Button onClick={() => {
                                    if (!subLineForm.materialId) return;
                                    const fd = new FormData();
                                    fd.append("intent","addSubAsmLine");
                                    fd.append("subAssemblyId", selectedSubAsmData.id);
                                    fd.append("materialId", subLineForm.materialId);
                                    fd.append("qty", subLineForm.qty);
                                    sub(fd);
                                    setSubLineForm({ materialId: "", qty: "1" });
                                  }}>Add</Button>
                                </Box>
                              </InlineStack>
                            </BlockStack>
                          </Card>
                        </BlockStack>
                      ) : (
                        <Box paddingBlockStart="800">
                          <Text tone="subdued" alignment="center">← Select a sub-assembly to edit its components</Text>
                        </Box>
                      )}
                    </Layout.Section>
                  </Layout>
                )}

                {/* ══════════ PRODUCTS & BOM TAB ══════════ */}
                {selectedTab === 2 && (
                  <Layout>
                    <Layout.Section variant="oneThird">
                      <BlockStack gap="200">
                        <Text variant="headingSm">Finished Products</Text>
                        {products.length === 0
                          ? <Text tone="subdued">Sync Shopify products first.</Text>
                          : products.map(prod => {
                              const canMake = getMaxProducible(prod);
                              const isSelected = selectedProduct?.id === prod.id;
                              return (
                                <Box key={prod.id} padding="300" borderWidth="025" borderRadius="200"
                                  borderColor={isSelected ? "border-emphasis" : "border"}
                                  background={isSelected ? "bg-surface-selected" : "bg-surface"}
                                  onClick={() => setSelectedProduct(prod)} style={{ cursor: "pointer" }}>
                                  <BlockStack gap="100">
                                    <Text fontWeight="medium">{prod.name}</Text>
                                    <Text variant="bodySm" tone="subdued">{prod.sku}</Text>
                                    <InlineStack gap="200">
                                      <Badge tone="info">COGS {fmt(getProductCOGS(prod))}</Badge>
                                      {canMake !== null && (
                                        <Badge tone={canMake > 10 ? "success" : canMake > 0 ? "warning" : "critical"}>
                                          Can make: {canMake}
                                        </Badge>
                                      )}
                                    </InlineStack>
                                  </BlockStack>
                                </Box>
                              );
                            })
                        }
                      </BlockStack>
                    </Layout.Section>

                    <Layout.Section>
                      {selectedProductData ? (
                        <BlockStack gap="400">
                          <Text variant="headingSm">BOM — {selectedProductData.name}</Text>
                          {selectedProductData.bomLines.length === 0
                            ? <Text tone="subdued">No BOM lines yet.</Text>
                            : <>
                                <Text variant="bodySm" tone="subdued" fontWeight="semibold">DIRECT BOM LINES</Text>
                                <DataTable
                                  columnContentTypes={["text","text","numeric","numeric","text",""]}
                                  headings={["Component","Type","Qty","Line Cost","Stock",""]}
                                  rows={selectedProductData.bomLines.map(line => {
                                    if (line.material) return [
                                      line.material.name, <Badge>Raw Material</Badge>, line.qty,
                                      fmt(line.material.cost * line.qty), stockBadge(line.material),
                                      <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deleteBomLine"); fd.append("id",line.id); sub(fd); }}>Remove</Button>,
                                    ];
                                    if (line.subAssembly) return [
                                      line.subAssembly.name, <Badge tone="attention">Sub-Assembly</Badge>, line.qty,
                                      fmt(getSubAsmCost(line.subAssembly) * line.qty),
                                      `${line.subAssembly.components.length} components`,
                                      <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deleteBomLine"); fd.append("id",line.id); sub(fd); }}>Remove</Button>,
                                    ];
                                    return ["—","—","—","—","",""];
                                  })}
                                />
                                {selectedProductData.bomLines.some(l => l.subAssembly) && (
                                  <>
                                    <Divider />
                                    <Text variant="bodySm" tone="subdued" fontWeight="semibold">FLATTENED RAW MATERIALS</Text>
                                    <DataTable
                                      columnContentTypes={["text","numeric","text","numeric","text"]}
                                      headings={["Raw Material","Total Qty","Unit","Total Cost","Via Sub-Assembly"]}
                                      rows={flattenForDisplay(selectedProductData).map(r => [
                                        r.name, r.qty, r.unit, fmt(r.cost * r.qty), r.via ? <Badge tone="attention">{r.via}</Badge> : "—",
                                      ])}
                                    />
                                  </>
                                )}
                              </>
                          }
                          <InlineStack gap="400">
                            <Text>Total COGS: <Text as="span" fontWeight="bold">{fmt(getProductCOGS(selectedProductData))}</Text></Text>
                            <Text>Max producible: <Text as="span" fontWeight="bold" tone={getMaxProducible(selectedProductData) > 0 ? "success" : "critical"}>{getMaxProducible(selectedProductData) ?? "—"} units</Text></Text>
                          </InlineStack>
                          <Card>
                            <BlockStack gap="300">
                              <Text variant="headingSm">Add BOM Line</Text>
                              <InlineStack gap="300" align="end">
                                <Select label="Raw Material"
                                  options={[{ label: "—", value: "" }, ...materials.map(m => ({ label: m.name, value: m.id }))]}
                                  value={bomMatForm.materialId}
                                  onChange={v => setBomMatForm(f => ({ ...f, materialId: v }))}
                                />
                                <TextField label="Qty" type="number" value={bomMatForm.qty} onChange={v => setBomMatForm(f => ({ ...f, qty: v }))} autoComplete="off" />
                                <Box paddingBlockStart="500">
                                  <Button disabled={!bomMatForm.materialId} onClick={() => {
                                    const fd = new FormData(); fd.append("intent","addBomLineMaterial"); fd.append("productId",selectedProductData.id); fd.append("materialId",bomMatForm.materialId); fd.append("qty",bomMatForm.qty); sub(fd); setBomMatForm({ materialId:"", qty:"1" });
                                  }}>Add Material</Button>
                                </Box>
                              </InlineStack>
                              {subAssemblies.length > 0 && (
                                <InlineStack gap="300" align="end">
                                  <Select label="Sub-Assembly"
                                    options={[{ label: "—", value: "" }, ...subAssemblies.map(s => ({ label: `${s.name} (${s.components.length} parts)`, value: s.id }))]}
                                    value={bomSubForm.subAssemblyId}
                                    onChange={v => setBomSubForm(f => ({ ...f, subAssemblyId: v }))}
                                  />
                                  <TextField label="Qty" type="number" value={bomSubForm.qty} onChange={v => setBomSubForm(f => ({ ...f, qty: v }))} autoComplete="off" />
                                  <Box paddingBlockStart="500">
                                    <Button disabled={!bomSubForm.subAssemblyId} onClick={() => {
                                      const fd = new FormData(); fd.append("intent","addBomLineSubAsm"); fd.append("productId",selectedProductData.id); fd.append("subAssemblyId",bomSubForm.subAssemblyId); fd.append("qty",bomSubForm.qty); sub(fd); setBomSubForm({ subAssemblyId:"", qty:"1" });
                                    }}>Add Sub-Assembly</Button>
                                  </Box>
                                </InlineStack>
                              )}
                            </BlockStack>
                          </Card>
                        </BlockStack>
                      ) : (
                        <Box paddingBlockStart="800">
                          <Text tone="subdued" alignment="center">← Select a product to manage its BOM</Text>
                        </Box>
                      )}
                    </Layout.Section>
                  </Layout>
                )}

                {/* ══════════ PRODUCTION RUNS TAB ══════════ */}
                {selectedTab === 3 && (
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingSm">Production Runs</Text>
                      <Button variant="primary" onClick={() => setShowAddProduction(true)} disabled={products.length === 0}>Log Production Run</Button>
                    </InlineStack>
                    <Text tone="subdued" variant="bodySm">
                      Recording a production run deducts the required raw materials from stock based on the product's BOM.
                    </Text>
                    {productionRuns.length === 0
                      ? <EmptyState heading="No production runs yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                          <p>Log a production run when you physically manufacture a batch of products.</p>
                        </EmptyState>
                      : <DataTable
                          columnContentTypes={["text","text","numeric","text"]}
                          headings={["Date","Product","Qty Produced","Note"]}
                          rows={productionRuns.map(r => [
                            new Date(r.createdAt).toLocaleString(),
                            r.product.name,
                            r.qty,
                            r.note || "—",
                          ])}
                        />
                    }
                  </BlockStack>
                )}

                {/* ══════════ PURCHASE ORDERS TAB ══════════ */}
                {selectedTab === 4 && (
                  <Layout>
                    <Layout.Section variant="oneThird">
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text variant="headingSm">Purchase Orders</Text>
                          <Button size="slim" onClick={() => setShowCreatePO(true)}>+ New PO</Button>
                        </InlineStack>
                        <Divider />
                        {purchaseOrders.length === 0
                          ? <Text tone="subdued">No purchase orders yet.</Text>
                          : purchaseOrders.map(po => {
                              const isSelected = selectedPO?.id === po.id;
                              const totalCost = po.lines.reduce((s, l) => s + l.qty * l.cost, 0);
                              return (
                                <Box key={po.id} padding="300" borderWidth="025" borderRadius="200"
                                  borderColor={isSelected ? "border-emphasis" : "border"}
                                  background={isSelected ? "bg-surface-selected" : "bg-surface"}
                                  onClick={() => setSelectedPO(po)} style={{ cursor: "pointer" }}>
                                  <InlineStack align="space-between">
                                    <BlockStack gap="050">
                                      <Text fontWeight="medium">{po.supplier || "No supplier"}</Text>
                                      <Text variant="bodySm" tone="subdued">{new Date(po.createdAt).toLocaleDateString()} · {po.lines.length} line(s)</Text>
                                    </BlockStack>
                                    <BlockStack gap="050" align="end">
                                      <Badge tone={po.status === "received" ? "success" : "attention"}>
                                        {po.status === "received" ? "Received" : "Draft"}
                                      </Badge>
                                      <Text variant="bodySm">{fmt(totalCost)}</Text>
                                    </BlockStack>
                                  </InlineStack>
                                </Box>
                              );
                            })
                        }
                      </BlockStack>
                    </Layout.Section>

                    <Layout.Section>
                      {selectedPOData ? (
                        <BlockStack gap="400">
                          <InlineStack align="space-between">
                            <Text variant="headingSm">PO — {selectedPOData.supplier || "No supplier"}</Text>
                            <InlineStack gap="200">
                              {selectedPOData.status === "draft" && (
                                <Button variant="primary" tone="success" onClick={() => {
                                  const fd = new FormData(); fd.append("intent","receivePO"); fd.append("id",selectedPOData.id); sub(fd); setSelectedPO(null);
                                }}>Mark as Received</Button>
                              )}
                              {selectedPOData.status === "draft" && (
                                <Button tone="critical" variant="plain" onClick={() => {
                                  const fd = new FormData(); fd.append("intent","deletePO"); fd.append("id",selectedPOData.id); sub(fd); setSelectedPO(null);
                                }}>Delete PO</Button>
                              )}
                            </InlineStack>
                          </InlineStack>
                          {selectedPOData.note && <Text tone="subdued">{selectedPOData.note}</Text>}
                          {selectedPOData.status === "received" && (
                            <Banner tone="success" title={`Received on ${new Date(selectedPOData.receivedAt).toLocaleDateString()}`}>
                              Stock has been updated for all lines.
                            </Banner>
                          )}

                          {selectedPOData.lines.length === 0
                            ? <Text tone="subdued">No lines yet. Add materials below.</Text>
                            : <DataTable
                                columnContentTypes={["text","numeric","text","numeric","numeric",""]}
                                headings={["Material","Qty","Unit","Unit Cost","Line Total",""]}
                                rows={selectedPOData.lines.map(l => [
                                  l.material.name,
                                  l.qty,
                                  l.material.unit,
                                  fmt(l.cost),
                                  fmt(l.qty * l.cost),
                                  selectedPOData.status === "draft"
                                    ? <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deletePOLine"); fd.append("id",l.id); sub(fd); }}>Remove</Button>
                                    : null,
                                ])}
                              />
                          }
                          <Text>Total: <Text as="span" fontWeight="bold">{fmt(selectedPOData.lines.reduce((s,l) => s + l.qty * l.cost, 0))}</Text></Text>

                          {selectedPOData.status === "draft" && (
                            <Card>
                              <BlockStack gap="300">
                                <Text variant="headingSm">Add Line</Text>
                                <InlineStack gap="300" align="end">
                                  <Select label="Material"
                                    options={[{ label: "Select...", value: "" }, ...materials.map(m => ({ label: m.name, value: m.id }))]}
                                    value={poLineForm.materialId}
                                    onChange={v => setPoLineForm(f => ({ ...f, materialId: v }))}
                                  />
                                  <TextField label="Qty" type="number" value={poLineForm.qty} onChange={v => setPoLineForm(f => ({ ...f, qty: v }))} autoComplete="off" />
                                  <TextField label="Unit Cost ($)" type="number" value={poLineForm.cost} onChange={v => setPoLineForm(f => ({ ...f, cost: v }))} autoComplete="off" />
                                  <Box paddingBlockStart="500">
                                    <Button disabled={!poLineForm.materialId} onClick={() => {
                                      const fd = new FormData();
                                      fd.append("intent","addPOLine");
                                      fd.append("purchaseOrderId", selectedPOData.id);
                                      fd.append("materialId", poLineForm.materialId);
                                      fd.append("qty", poLineForm.qty);
                                      fd.append("cost", poLineForm.cost);
                                      sub(fd);
                                      setPoLineForm({ materialId: "", qty: "1", cost: "0" });
                                    }}>Add</Button>
                                  </Box>
                                </InlineStack>
                              </BlockStack>
                            </Card>
                          )}
                        </BlockStack>
                      ) : (
                        <Box paddingBlockStart="800">
                          <Text tone="subdued" alignment="center">← Select a purchase order to manage it</Text>
                        </Box>
                      )}
                    </Layout.Section>
                  </Layout>
                )}

                {/* ══════════ STOCK LOG TAB ══════════ */}
                {selectedTab === 5 && (
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingSm">Stock Movement Log</Text>
                      <Badge tone="info">Auto-updated on orders, cancellations, refunds &amp; production</Badge>
                    </InlineStack>
                    {movements.length === 0
                      ? <EmptyState heading="No movements yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                          <p>Movements appear automatically when orders are placed, cancelled, refunded, or production runs are logged.</p>
                        </EmptyState>
                      : <DataTable
                          columnContentTypes={["text","text","text","numeric","text","text"]}
                          headings={["Date","Material","Type","Qty","Reference","Note"]}
                          rows={movements.map(m => [
                            new Date(m.createdAt).toLocaleString(),
                            m.material?.name ?? "—",
                            <Badge tone={m.qty < 0 ? "critical" : "success"}>{m.type}</Badge>,
                            <Text tone={m.qty < 0 ? "critical" : "success"} fontWeight="bold">{m.qty > 0 ? `+${m.qty}` : m.qty}</Text>,
                            m.reference,
                            <Text tone="subdued" variant="bodySm">{m.note}</Text>,
                          ])}
                        />
                    }
                  </BlockStack>
                )}

              </Box>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>

      {/* ── Add / Edit Material Modal ── */}
      <Modal
        open={showAddMat}
        onClose={() => { setShowAddMat(false); setEditingMat(null); }}
        title={editingMat ? `Edit — ${editingMat.name}` : "Add Raw Material"}
        primaryAction={{
          content: "Save",
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", editingMat ? "editMaterial" : "addMaterial");
            if (editingMat) fd.append("id", editingMat.id);
            Object.entries(matForm).forEach(([k, v]) => fd.append(k, v));
            sub(fd);
            setShowAddMat(false);
            setEditingMat(null);
            setMatForm({ sku: "", name: "", unit: "pcs", stock: "0", reorderPoint: "0", cost: "0", supplier: "" });
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => { setShowAddMat(false); setEditingMat(null); } }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <InlineStack gap="300">
              <TextField label="SKU" value={matForm.sku} onChange={v => setMatForm(f=>({...f,sku:v}))} autoComplete="off" disabled={!!editingMat} />
              <TextField label="Name" value={matForm.name} onChange={v => setMatForm(f=>({...f,name:v}))} autoComplete="off" />
            </InlineStack>
            <InlineStack gap="300">
              <Select label="Unit" options={["pcs","meters","kg","g","liters","ml","spools","sheets","rolls"].map(u=>({label:u,value:u}))} value={matForm.unit} onChange={v => setMatForm(f=>({...f,unit:v}))} />
              <TextField label="Supplier" value={matForm.supplier} onChange={v => setMatForm(f=>({...f,supplier:v}))} autoComplete="off" />
            </InlineStack>
            <InlineStack gap="300">
              <TextField label="Stock" type="number" value={matForm.stock} onChange={v => setMatForm(f=>({...f,stock:v}))} autoComplete="off" />
              <TextField label="Reorder Point" type="number" value={matForm.reorderPoint} onChange={v => setMatForm(f=>({...f,reorderPoint:v}))} autoComplete="off" />
              <TextField label="Cost/Unit ($)" type="number" value={matForm.cost} onChange={v => setMatForm(f=>({...f,cost:v}))} autoComplete="off" />
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── Add Sub-Assembly Modal ── */}
      <Modal open={showAddSub} onClose={() => setShowAddSub(false)} title="New Sub-Assembly"
        primaryAction={{ content: "Save", onAction: () => { const fd = new FormData(); fd.append("intent","addSubAssembly"); Object.entries(subForm).forEach(([k,v]) => fd.append(k,v)); sub(fd); setShowAddSub(false); setSubForm({ sku:"",name:"",unit:"pcs",description:"" }); }}}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowAddSub(false) }]}>
        <Modal.Section>
          <BlockStack gap="300">
            <InlineStack gap="300">
              <TextField label="SKU" value={subForm.sku} onChange={v => setSubForm(f=>({...f,sku:v}))} autoComplete="off" />
              <TextField label="Name" value={subForm.name} onChange={v => setSubForm(f=>({...f,name:v}))} autoComplete="off" />
              <Select label="Unit" options={["pcs","sets","pairs","assemblies"].map(u=>({label:u,value:u}))} value={subForm.unit} onChange={v => setSubForm(f=>({...f,unit:v}))} />
            </InlineStack>
            <TextField label="Description (optional)" value={subForm.description} onChange={v => setSubForm(f=>({...f,description:v}))} autoComplete="off" multiline={2} />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── Log Production Run Modal ── */}
      <Modal open={showAddProduction} onClose={() => setShowAddProduction(false)} title="Log Production Run"
        primaryAction={{
          content: "Log Run",
          onAction: () => {
            if (!productionForm.productId) return;
            const fd = new FormData();
            fd.append("intent","addProductionRun");
            fd.append("productId", productionForm.productId);
            fd.append("qty", productionForm.qty);
            fd.append("note", productionForm.note);
            sub(fd);
            setShowAddProduction(false);
            setProductionForm({ productId: "", qty: "1", note: "" });
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowAddProduction(false) }]}>
        <Modal.Section>
          <BlockStack gap="300">
            <Select label="Product"
              options={[{ label: "Select product...", value: "" }, ...products.map(p => ({ label: p.name, value: p.id }))]}
              value={productionForm.productId}
              onChange={v => setProductionForm(f => ({ ...f, productId: v }))}
            />
            <TextField label="Qty Produced" type="number" value={productionForm.qty} onChange={v => setProductionForm(f => ({ ...f, qty: v }))} autoComplete="off" />
            <TextField label="Note (optional)" value={productionForm.note} onChange={v => setProductionForm(f => ({ ...f, note: v }))} autoComplete="off" />
            <Banner tone="info" title="Materials will be deducted">
              Raw materials required by this product's BOM will be deducted from stock automatically.
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── Create Purchase Order Modal ── */}
      <Modal open={showCreatePO} onClose={() => setShowCreatePO(false)} title="New Purchase Order"
        primaryAction={{
          content: "Create PO",
          onAction: () => {
            const fd = new FormData();
            fd.append("intent","createPO");
            fd.append("supplier", poForm.supplier);
            fd.append("note", poForm.note);
            sub(fd);
            setShowCreatePO(false);
            setPoForm({ supplier: "", note: "" });
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowCreatePO(false) }]}>
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
