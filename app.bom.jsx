import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Modal, TextField, Select,
  EmptyState, Divider, Box, Banner,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [products, materials, subAssemblies] = await Promise.all([
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
    prisma.material.findMany({ where: { shop }, orderBy: { name: "asc" } }),
    prisma.subAssembly.findMany({
      where: { shop },
      include: { components: { include: { material: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return json({ products, materials, subAssemblies });
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");

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
  return json({ ok: false });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;

function flattenForDisplay(product) {
  const map = {};
  for (const line of product.bomLines) {
    if (line.material) {
      map[line.materialId] = map[line.materialId] || { id: line.materialId, name: line.material.name, unit: line.material.unit, cost: line.material.cost, stock: line.material.stock, qty: 0, via: null };
      map[line.materialId].qty += line.qty;
    } else if (line.subAssembly) {
      for (const comp of line.subAssembly.components) {
        map[comp.materialId] = map[comp.materialId] || { id: comp.materialId, name: comp.material.name, unit: comp.material.unit, cost: comp.material.cost, stock: comp.material.stock, qty: 0, via: line.subAssembly.name };
        map[comp.materialId].qty += comp.qty * line.qty;
      }
    }
  }
  return Object.values(map);
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
    if (line.subAssembly) for (const c of line.subAssembly.components) stockMap[c.material.id] = c.material.stock;
  }
  return Math.floor(Math.min(...flat.map(r => r.qty > 0 ? (stockMap[r.id] ?? 0) / r.qty : Infinity)));
}

function getSubAsmCost(sub) {
  return sub.components.reduce((s, c) => s + c.material.cost * c.qty, 0);
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
  .Polaris-TextField__Input { background: #1a1a1a !important; color: #fff !important; }
  .Polaris-TextField__Backdrop { background: #1a1a1a !important; border-color: #2a2a2a !important; }
  .Polaris-Modal-Dialog__Modal { background: #111 !important; border: 1px solid #2a2a2a !important; }
  .Polaris-Modal-Header { border-bottom: 1px solid #1f1f1f !important; }
  .Polaris-Modal-Footer { border-top: 1px solid #1f1f1f !important; }
  .Polaris-Label__Text { color: #888 !important; font-size: 12px !important; }
  .sd-product-card { background: #0a0a0a; border: 1px solid #1f1f1f; border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: border-color 0.15s; }
  .sd-product-card:hover { border-color: #444; }
  .sd-product-card.selected { border-color: #fff; }
  .sd-bom-tree-line { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #1a1a1a; }
  .sd-bom-tree-line:last-child { border-bottom: none; }
`;

export default function BOM() {
  const { products, materials, subAssemblies } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state !== "idle";

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [bomMatForm, setBomMatForm] = useState({ materialId: "", qty: "1" });
  const [bomSubForm, setBomSubForm] = useState({ subAssemblyId: "", qty: "1" });

  const sub = (fd) => submit(fd, { method: "post" });

  const selectedProductData = selectedProduct ? products.find(p => p.id === selectedProduct) : null;
  const canMake = selectedProductData ? getMaxProducible(selectedProductData) : null;

  return (
    <Page
      title="Bill of Materials"
      primaryAction={{
        content: "Sync Shopify Products",
        loading: isLoading,
        onAction: () => { const fd = new FormData(); fd.append("intent", "syncShopify"); sub(fd); }
      }}
    >
      <style>{darkStyles}</style>
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" fontWeight="bold">Products</Text>
              <Divider />
              {products.length === 0 ? (
                <Text tone="subdued" variant="bodySm">Sync your Shopify products first.</Text>
              ) : (
                <BlockStack gap="200">
                  {products.map(prod => {
                    const cogs = getProductCOGS(prod);
                    const canMakeProd = getMaxProducible(prod);
                    const isSelected = selectedProduct === prod.id;
                    return (
                      <div
                        key={prod.id}
                        className={`sd-product-card${isSelected ? " selected" : ""}`}
                        onClick={() => setSelectedProduct(prod.id)}
                      >
                        <BlockStack gap="100">
                          <Text fontWeight="semibold">{prod.name}</Text>
                          <Text variant="bodySm" tone="subdued">{prod.sku}</Text>
                          <InlineStack gap="200">
                            <Badge tone="info">COGS {fmt(cogs)}</Badge>
                            {canMakeProd !== null && (
                              <Badge tone={canMakeProd > 10 ? "success" : canMakeProd > 0 ? "warning" : "critical"}>
                                Can make: {canMakeProd}
                              </Badge>
                            )}
                          </InlineStack>
                        </BlockStack>
                      </div>
                    );
                  })}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {selectedProductData ? (
            <BlockStack gap="400">
              {/* BOM summary strip */}
              <div style={{ display: "flex", gap: "12px" }}>
                {[
                  { label: "COGS", value: fmt(getProductCOGS(selectedProductData)) },
                  { label: "Can Produce", value: canMake !== null ? `${canMake} units` : "—", color: canMake === 0 ? "#ff4444" : canMake !== null && canMake <= 5 ? "#f0a500" : "#22c55e" },
                  { label: "BOM Lines", value: selectedProductData.bomLines.length },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "#0a0a0a", border: "1px solid #1f1f1f", borderRadius: "8px", padding: "14px 18px", flex: 1 }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: "#555", marginBottom: "4px" }}>{label}</div>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: color || "#fff" }}>{value}</div>
                  </div>
                ))}
              </div>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" fontWeight="bold">BOM — {selectedProductData.name}</Text>
                  <Divider />
                  {selectedProductData.bomLines.length === 0 ? (
                    <Text tone="subdued">No BOM lines yet. Add components below.</Text>
                  ) : (
                    <div>
                      {selectedProductData.bomLines.map(line => {
                        const isSubAsm = !!line.subAssembly;
                        const name = line.material?.name || line.subAssembly?.name;
                        const cost = line.material
                          ? line.material.cost * line.qty
                          : getSubAsmCost(line.subAssembly) * line.qty;
                        return (
                          <div key={line.id} className="sd-bom-tree-line">
                            <div style={{ width: "3px", height: "32px", background: isSubAsm ? "#f0a500" : "#3b82f6", borderRadius: "2px", flexShrink: 0 }} />
                            <BlockStack gap="025" style={{ flex: 1 }}>
                              <Text fontWeight="medium">{name}</Text>
                              {isSubAsm && (
                                <Text variant="bodySm" tone="subdued">
                                  {line.subAssembly.components.length} components
                                </Text>
                              )}
                            </BlockStack>
                            <Badge tone={isSubAsm ? "attention" : "info"}>
                              {isSubAsm ? "Sub-Assembly" : "Raw Material"}
                            </Badge>
                            <Text variant="bodySm" tone="subdued">×{line.qty}</Text>
                            <Text fontWeight="medium">{fmt(cost)}</Text>
                            <Button size="slim" tone="critical" variant="plain" onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "deleteBomLine");
                              fd.append("id", line.id);
                              sub(fd);
                            }}>Remove</Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </BlockStack>
              </Card>

              {/* Add BOM line */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" fontWeight="bold">Add Component</Text>
                  <Divider />
                  <InlineStack gap="300" align="end">
                    <Select label="Raw Material"
                      options={[{ label: "Select material...", value: "" }, ...materials.map(m => ({ label: `${m.name} (${m.stock} ${m.unit})`, value: m.id }))]}
                      value={bomMatForm.materialId}
                      onChange={v => setBomMatForm(f => ({ ...f, materialId: v }))}
                    />
                    <TextField label="Qty" type="number" value={bomMatForm.qty}
                      onChange={v => setBomMatForm(f => ({ ...f, qty: v }))} autoComplete="off" />
                    <Box paddingBlockStart="500">
                      <Button disabled={!bomMatForm.materialId} onClick={() => {
                        const fd = new FormData();
                        fd.append("intent", "addBomLineMaterial");
                        fd.append("productId", selectedProductData.id);
                        fd.append("materialId", bomMatForm.materialId);
                        fd.append("qty", bomMatForm.qty);
                        sub(fd);
                        setBomMatForm({ materialId: "", qty: "1" });
                      }}>Add Material</Button>
                    </Box>
                  </InlineStack>
                  {subAssemblies.length > 0 && (
                    <InlineStack gap="300" align="end">
                      <Select label="Sub-Assembly"
                        options={[{ label: "Select sub-assembly...", value: "" }, ...subAssemblies.map(s => ({ label: `${s.name} (${s.components.length} parts)`, value: s.id }))]}
                        value={bomSubForm.subAssemblyId}
                        onChange={v => setBomSubForm(f => ({ ...f, subAssemblyId: v }))}
                      />
                      <TextField label="Qty" type="number" value={bomSubForm.qty}
                        onChange={v => setBomSubForm(f => ({ ...f, qty: v }))} autoComplete="off" />
                      <Box paddingBlockStart="500">
                        <Button disabled={!bomSubForm.subAssemblyId} onClick={() => {
                          const fd = new FormData();
                          fd.append("intent", "addBomLineSubAsm");
                          fd.append("productId", selectedProductData.id);
                          fd.append("subAssemblyId", bomSubForm.subAssemblyId);
                          fd.append("qty", bomSubForm.qty);
                          sub(fd);
                          setBomSubForm({ subAssemblyId: "", qty: "1" });
                        }}>Add Sub-Assembly</Button>
                      </Box>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>

              {/* Flattened view */}
              {selectedProductData.bomLines.some(l => l.subAssembly) && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingSm" fontWeight="bold">Flattened Raw Materials</Text>
                    <Divider />
                    <DataTable
                      columnContentTypes={["text", "numeric", "text", "numeric", "text"]}
                      headings={["Raw Material", "Total Qty", "Unit", "Total Cost", "Via"]}
                      rows={flattenForDisplay(selectedProductData).map(r => [
                        r.name, r.qty, r.unit, fmt(r.cost * r.qty),
                        r.via ? <Badge tone="attention">{r.via}</Badge> : "—",
                      ])}
                    />
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          ) : (
            <Card>
              <Box padding="800">
                <Text tone="subdued" alignment="center">← Select a product to manage its BOM</Text>
              </Box>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
