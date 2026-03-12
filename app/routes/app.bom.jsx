import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, TextField, Select,
  EmptyState, Divider, Box, InlineGrid,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [products, materials, subAssemblies] = await Promise.all([
    prisma.product.findMany({ where: { shop }, include: { bomLines: { include: { material: true, subAssembly: { include: { components: { include: { material: true } } } } } } }, orderBy: { name: "asc" } }),
    prisma.material.findMany({ where: { shop }, orderBy: { name: "asc" } }),
    prisma.subAssembly.findMany({ where: { shop }, include: { components: { include: { material: true } } }, orderBy: { name: "asc" } }),
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
    const shopifyProducts = data.data.products.edges.map(e => ({ shopifyId: e.node.id, name: e.node.title, sku: e.node.variants.edges[0]?.node.sku || e.node.id.split("/").pop() }));
    for (const p of shopifyProducts) {
      await prisma.product.upsert({ where: { shop_shopifyId: { shop, shopifyId: p.shopifyId } }, update: { name: p.name, sku: p.sku }, create: { shop, ...p } });
    }
    return json({ ok: true });
  }
  if (intent === "addBomLineMaterial") {
    await prisma.bomLine.create({ data: { productId: fd.get("productId"), materialId: fd.get("materialId"), qty: +fd.get("qty") } });
    return json({ ok: true });
  }
  if (intent === "addBomLineSubAsm") {
    await prisma.bomLine.create({ data: { productId: fd.get("productId"), subAssemblyId: fd.get("subAssemblyId"), qty: +fd.get("qty") } });
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

function getProductCOGS(product) { return flattenForDisplay(product).reduce((s, r) => s + r.cost * r.qty, 0); }
function getSubAsmCost(sub) { return sub.components.reduce((s, c) => s + c.material.cost * c.qty, 0); }
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

export default function BOM() {
  const { products, materials, subAssemblies } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state !== "idle";
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [bomMatForm, setBomMatForm] = useState({ materialId: "", qty: "1" });
  const [bomSubForm, setBomSubForm] = useState({ subAssemblyId: "", qty: "1" });
  const sub = (fd) => submit(fd, { method: "post" });
  const selectedProductData = selectedProduct ? products.find(p => p.id === selectedProduct) : null;
  const canMake = selectedProductData ? getMaxProducible(selectedProductData) : null;
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Page title="Bill of Materials" primaryAction={{ content: "Sync Shopify Products", loading: isLoading, onAction: () => { const fd = new FormData(); fd.append("intent","syncShopify"); sub(fd); } }}>
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Products ({filteredProducts.length})</Text>
              <TextField label="Search" labelHidden placeholder="Search by name or SKU..." value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} />
              <Divider />
              {products.length === 0
                ? <Text tone="subdued" variant="bodySm">Sync your Shopify products first.</Text>
                : <BlockStack gap="200">
                    {filteredProducts.map(prod => {
                      const cogs = getProductCOGS(prod);
                      const canMakeProd = getMaxProducible(prod);
                      const isSelected = selectedProduct === prod.id;
                      return (
                        <Box key={prod.id} padding="300" borderWidth="025" borderRadius="200" borderColor={isSelected ? "border-emphasis" : "border"} background={isSelected ? "bg-surface-selected" : "bg-surface"} onClick={() => setSelectedProduct(prod.id)} style={{ cursor: "pointer" }}>
                          <BlockStack gap="100">
                            <Text fontWeight="semibold">{prod.name}</Text>
                            <Text variant="bodySm" tone="subdued">{prod.sku}</Text>
                            <InlineStack gap="200">
                              <Badge tone="info">COGS {fmt(cogs)}</Badge>
                              {canMakeProd !== null && <Badge tone={canMakeProd > 10 ? "success" : canMakeProd > 0 ? "warning" : "critical"}>Can make: {canMakeProd}</Badge>}
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      );
                    })}
                  </BlockStack>
              }
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {selectedProductData ? (
            <BlockStack gap="400">
              <InlineGrid columns={3} gap="400">
                {[
                  { label: "COGS", value: fmt(getProductCOGS(selectedProductData)) },
                  { label: "Can Produce", value: canMake !== null ? `${canMake} units` : "—", tone: canMake === 0 ? "critical" : canMake !== null && canMake <= 5 ? "caution" : undefined },
                  { label: "BOM Lines", value: selectedProductData.bomLines.length },
                ].map(({ label, value, tone }) => (
                  <Card key={label}>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">{label}</Text>
                      <Text variant="headingXl" as="p" tone={tone}>{value}</Text>
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">BOM — {selectedProductData.name}</Text>
                  <TextField label="Search" labelHidden placeholder="Search by name or SKU..." value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} />
              <Divider />
                  {selectedProductData.bomLines.length === 0
                    ? <Text tone="subdued">No BOM lines yet. Add components below.</Text>
                    : <DataTable
                        columnContentTypes={["text","text","numeric","numeric",""]}
                        headings={["Component","Type","Qty","Line Cost",""]}
                        rows={selectedProductData.bomLines.map(line => {
                          if (line.material) return [
                            <Text fontWeight="medium">{line.material.name}</Text>,
                            <Badge>Raw Material</Badge>,
                            line.qty,
                            fmt(line.material.cost * line.qty),
                            <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deleteBomLine"); fd.append("id",line.id); sub(fd); }}>Remove</Button>,
                          ];
                          if (line.subAssembly) return [
                            <Text fontWeight="medium">{line.subAssembly.name}</Text>,
                            <Badge tone="attention">Sub-Assembly</Badge>,
                            line.qty,
                            fmt(getSubAsmCost(line.subAssembly) * line.qty),
                            <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deleteBomLine"); fd.append("id",line.id); sub(fd); }}>Remove</Button>,
                          ];
                          return ["—","—","—","—",""];
                        })}
                      />
                  }
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Add Component</Text>
                  <TextField label="Search" labelHidden placeholder="Search by name or SKU..." value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} />
              <Divider />
                  <InlineStack gap="300" align="end">
                    <Select label="Raw Material" options={[{ label: "Select...", value: "" }, ...materials.map(m => ({ label: `${m.name} (${m.stock} ${m.unit})`, value: m.id }))]} value={bomMatForm.materialId} onChange={v => setBomMatForm(f=>({...f,materialId:v}))} />
                    <TextField label="Qty" type="number" value={bomMatForm.qty} onChange={v => setBomMatForm(f=>({...f,qty:v}))} autoComplete="off" />
                    <Box paddingBlockStart="500">
                      <Button disabled={!bomMatForm.materialId} onClick={() => { const fd = new FormData(); fd.append("intent","addBomLineMaterial"); fd.append("productId",selectedProductData.id); fd.append("materialId",bomMatForm.materialId); fd.append("qty",bomMatForm.qty); sub(fd); setBomMatForm({materialId:"",qty:"1"}); }}>Add Material</Button>
                    </Box>
                  </InlineStack>
                  {subAssemblies.length > 0 && (
                    <InlineStack gap="300" align="end">
                      <Select label="Sub-Assembly" options={[{ label: "Select...", value: "" }, ...subAssemblies.map(s => ({ label: `${s.name} (${s.components.length} parts)`, value: s.id }))]} value={bomSubForm.subAssemblyId} onChange={v => setBomSubForm(f=>({...f,subAssemblyId:v}))} />
                      <TextField label="Qty" type="number" value={bomSubForm.qty} onChange={v => setBomSubForm(f=>({...f,qty:v}))} autoComplete="off" />
                      <Box paddingBlockStart="500">
                        <Button disabled={!bomSubForm.subAssemblyId} onClick={() => { const fd = new FormData(); fd.append("intent","addBomLineSubAsm"); fd.append("productId",selectedProductData.id); fd.append("subAssemblyId",bomSubForm.subAssemblyId); fd.append("qty",bomSubForm.qty); sub(fd); setBomSubForm({subAssemblyId:"",qty:"1"}); }}>Add Sub-Assembly</Button>
                      </Box>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>

              {selectedProductData.bomLines.some(l => l.subAssembly) && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">Flattened Raw Materials</Text>
                    <TextField label="Search" labelHidden placeholder="Search by name or SKU..." value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} />
              <Divider />
                    <DataTable
                      columnContentTypes={["text","numeric","text","numeric","text"]}
                      headings={["Raw Material","Total Qty","Unit","Total Cost","Via"]}
                      rows={flattenForDisplay(selectedProductData).map(r => [r.name, r.qty, r.unit, fmt(r.cost * r.qty), r.via ? <Badge tone="attention">{r.via}</Badge> : "—"])}
                    />
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          ) : (
            <Card>
              <Box padding="800">
                <EmptyState heading="Select a product" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Select a product on the left to view and manage its Bill of Materials.</p>
                </EmptyState>
              </Box>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
