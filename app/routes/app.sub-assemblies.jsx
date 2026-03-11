import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Button, Badge, Text,
  InlineStack, BlockStack, Modal, TextField, Select,
  EmptyState, Divider, Box, InlineGrid,
} from "@shopify/polaris";
import { authenticate, prisma } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [subAssemblies, materials] = await Promise.all([
    prisma.subAssembly.findMany({ where: { shop }, include: { components: { include: { material: true } } }, orderBy: { name: "asc" } }),
    prisma.material.findMany({ where: { shop }, orderBy: { name: "asc" } }),
  ]);
  return json({ subAssemblies, materials });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "addSubAssembly") {
    const sku = fd.get("sku");
    await prisma.subAssembly.upsert({ where: { shop_sku: { shop, sku } }, update: { name: fd.get("name"), unit: fd.get("unit"), description: fd.get("description") || null }, create: { shop, sku, name: fd.get("name"), unit: fd.get("unit"), description: fd.get("description") || null } });
    return json({ ok: true });
  }
  if (intent === "deleteSubAssembly") {
    await prisma.subAssembly.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }
  if (intent === "addSubAsmLine") {
    const subAssemblyId = fd.get("subAssemblyId"), materialId = fd.get("materialId");
    await prisma.subAsmLine.upsert({ where: { subAssemblyId_materialId: { subAssemblyId, materialId } }, update: { qty: +fd.get("qty") }, create: { subAssemblyId, materialId, qty: +fd.get("qty") } });
    return json({ ok: true });
  }
  if (intent === "deleteSubAsmLine") {
    await prisma.subAsmLine.delete({ where: { id: fd.get("id") } });
    return json({ ok: true });
  }
  return json({ ok: false });
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;
const getSubAsmCost = (sub) => sub.components.reduce((s, c) => s + c.material.cost * c.qty, 0);
const emptyForm = { sku: "", name: "", unit: "pcs", description: "" };

export default function SubAssemblies() {
  const { subAssemblies, materials } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state !== "idle";
  const [selectedSub, setSelectedSub] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [lineForm, setLineForm] = useState({ materialId: "", qty: "1" });
  const sub = (fd) => submit(fd, { method: "post" });
  const f = (k) => (v) => setForm(p => ({ ...p, [k]: v }));
  const selectedSubData = selectedSub ? subAssemblies.find(s => s.id === selectedSub) : null;

  return (
    <Page title="Sub-Assemblies" primaryAction={{ content: "New Sub-Assembly", onAction: () => { setForm(emptyForm); setShowModal(true); } }}>
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Sub-Assemblies</Text>
              <Text variant="bodySm" tone="subdued">Intermediate components made from raw materials, used within product BOMs.</Text>
              <Divider />
              {subAssemblies.length === 0
                ? <Text tone="subdued" variant="bodySm">No sub-assemblies yet.</Text>
                : <BlockStack gap="200">
                    {subAssemblies.map(s => (
                      <Box key={s.id} padding="300" borderWidth="025" borderRadius="200" borderColor={selectedSub === s.id ? "border-emphasis" : "border"} background={selectedSub === s.id ? "bg-surface-selected" : "bg-surface"} onClick={() => setSelectedSub(s.id)} style={{ cursor: "pointer" }}>
                        <InlineStack align="space-between">
                          <BlockStack gap="050">
                            <Text fontWeight="semibold">{s.name}</Text>
                            <Text variant="bodySm" tone="subdued">{s.sku} · {s.components.length} component(s)</Text>
                          </BlockStack>
                          <BlockStack gap="100" align="end">
                            <Badge tone="info">{fmt(getSubAsmCost(s))}</Badge>
                            <Button size="slim" tone="critical" variant="plain" onClick={(e) => { e.stopPropagation(); const fd = new FormData(); fd.append("intent","deleteSubAssembly"); fd.append("id",s.id); sub(fd); if (selectedSub === s.id) setSelectedSub(null); }}>Delete</Button>
                          </BlockStack>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
              }
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {selectedSubData ? (
            <BlockStack gap="400">
              <InlineGrid columns={3} gap="400">
                {[
                  { label: "Components", value: selectedSubData.components.length },
                  { label: "Cost / Unit", value: fmt(getSubAsmCost(selectedSubData)) },
                  { label: "Unit", value: selectedSubData.unit },
                ].map(({ label, value }) => (
                  <Card key={label}>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">{label}</Text>
                      <Text variant="headingXl" as="p">{value}</Text>
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Components — {selectedSubData.name}</Text>
                  {selectedSubData.description && <Text tone="subdued" variant="bodySm">{selectedSubData.description}</Text>}
                  <Divider />
                  {selectedSubData.components.length === 0
                    ? <Text tone="subdued">No components yet.</Text>
                    : <DataTable
                        columnContentTypes={["text","numeric","text","numeric",""]}
                        headings={["Raw Material","Qty","Unit","Line Cost",""]}
                        rows={selectedSubData.components.map(c => [
                          c.material.name, c.qty, c.material.unit, fmt(c.material.cost * c.qty),
                          <Button size="slim" tone="critical" variant="plain" onClick={() => { const fd = new FormData(); fd.append("intent","deleteSubAsmLine"); fd.append("id",c.id); sub(fd); }}>Remove</Button>,
                        ])}
                      />
                  }
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Add Component</Text>
                  <Divider />
                  <InlineStack gap="300" align="end">
                    <Select label="Raw Material" options={[{ label: "Select...", value: "" }, ...materials.map(m => ({ label: `${m.name} (${m.stock} ${m.unit})`, value: m.id }))]} value={lineForm.materialId} onChange={v => setLineForm(f=>({...f,materialId:v}))} />
                    <TextField label="Qty" type="number" value={lineForm.qty} onChange={v => setLineForm(f=>({...f,qty:v}))} autoComplete="off" />
                    <Box paddingBlockStart="500">
                      <Button disabled={!lineForm.materialId} onClick={() => { const fd = new FormData(); fd.append("intent","addSubAsmLine"); fd.append("subAssemblyId",selectedSubData.id); fd.append("materialId",lineForm.materialId); fd.append("qty",lineForm.qty); sub(fd); setLineForm({materialId:"",qty:"1"}); }}>Add</Button>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          ) : (
            <Card>
              <Box padding="800">
                <EmptyState heading="Select a sub-assembly" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Select a sub-assembly on the left to manage its components.</p>
                </EmptyState>
              </Box>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Sub-Assembly"
        primaryAction={{ content: "Save", loading: isLoading, onAction: () => { const fd = new FormData(); fd.append("intent","addSubAssembly"); Object.entries(form).forEach(([k,v]) => fd.append(k,v)); sub(fd); setShowModal(false); setForm(emptyForm); }}}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <InlineStack gap="300">
              <TextField label="SKU *" value={form.sku} onChange={f("sku")} autoComplete="off" />
              <TextField label="Name *" value={form.name} onChange={f("name")} autoComplete="off" />
              <Select label="Unit" value={form.unit} onChange={f("unit")} options={["pcs","sets","pairs","assemblies"].map(u=>({label:u,value:u}))} />
            </InlineStack>
            <TextField label="Description (optional)" value={form.description} onChange={f("description")} autoComplete="off" multiline={2} />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
