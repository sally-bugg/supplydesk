import { authenticate, prisma } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`[SupplyDesk Webhook] ${topic} from ${shop}`);

  switch (topic) {
    case "ORDERS_CREATE":    await handleOrderCreate(shop, payload); break;
    case "ORDERS_CANCELLED": await handleOrderCancel(shop, payload); break;
    case "REFUNDS_CREATE":   await handleRefund(shop, payload); break;
    default: break;
  }

  return new Response("OK", { status: 200 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Core: flatten a product's BOM into a map of { materialId -> totalQty }
// Handles unlimited nesting — sub-assemblies within sub-assemblies.
// multiplier = how many of the top-level product were ordered.
// ─────────────────────────────────────────────────────────────────────────────
async function flattenBom(shop, productId, multiplier = 1, depth = 0) {
  if (depth > 10) {
    console.warn("[SupplyDesk] BOM depth limit reached — possible circular reference");
    return {};
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      bomLines: {
        include: {
          material: true,
          subAssembly: {
            include: { components: { include: { material: true } } },
          },
        },
      },
    },
  });

  if (!product) return {};

  const totals = {}; // materialId -> { qty, material }

  for (const line of product.bomLines) {
    const lineQty = line.qty * multiplier;

    if (line.material) {
      // Direct raw material
      totals[line.materialId] = {
        qty: (totals[line.materialId]?.qty || 0) + lineQty,
        material: line.material,
      };
    } else if (line.subAssembly) {
      // Sub-assembly: expand its components, scaled by how many we need
      const sub = line.subAssembly;
      for (const comp of sub.components) {
        const compQty = comp.qty * lineQty;
        totals[comp.materialId] = {
          qty: (totals[comp.materialId]?.qty || 0) + compQty,
          material: comp.material,
        };
      }
      // Sub-assemblies can themselves reference sub-assemblies via their
      // own product record — check if one exists
      const subProduct = await prisma.product.findFirst({
        where: { shop, sku: sub.sku },
      });
      if (subProduct) {
        const nested = await flattenBom(shop, subProduct.id, lineQty, depth + 1);
        for (const [matId, entry] of Object.entries(nested)) {
          totals[matId] = {
            qty: (totals[matId]?.qty || 0) + entry.qty,
            material: entry.material,
          };
        }
      }
    }
  }

  return totals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduct stock for all raw materials in a flattened BOM
// ─────────────────────────────────────────────────────────────────────────────
async function deductMaterials(shop, flatBom, reference, productName, orderQty) {
  for (const [materialId, entry] of Object.entries(flatBom)) {
    const deduct = entry.qty; // already scaled by order qty in flattenBom
    const current = await prisma.material.findUnique({ where: { id: materialId } });
    if (!current) continue;

    await prisma.material.update({
      where: { id: materialId },
      data: { stock: Math.max(0, current.stock - deduct) },
    });

    await prisma.stockMovement.create({
      data: {
        shop,
        materialId,
        type: "ORDER",
        qty: -deduct,
        reference,
        note: `Auto-deducted for ${orderQty}x ${productName}`,
      },
    });

    console.log(`[SupplyDesk] -${deduct} "${entry.material.name}" → ${reference}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore stock (cancel / refund)
// ─────────────────────────────────────────────────────────────────────────────
async function restoreMaterials(shop, flatBom, reference, productName, qty, type) {
  for (const [materialId, entry] of Object.entries(flatBom)) {
    await prisma.material.update({
      where: { id: materialId },
      data: { stock: { increment: entry.qty } },
    });

    await prisma.stockMovement.create({
      data: {
        shop,
        materialId,
        type,
        qty: entry.qty,
        reference,
        note: `Restored for ${qty}x ${productName}`,
      },
    });

    console.log(`[SupplyDesk] +${entry.qty} "${entry.material.name}" → ${reference}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook handlers
// ─────────────────────────────────────────────────────────────────────────────
async function handleOrderCreate(shop, order) {
  for (const item of order.line_items || []) {
    const shopifyProductId = `gid://shopify/Product/${item.product_id}`;
    const orderQty = item.quantity || 1;

    const product = await prisma.product.findUnique({
      where: { shop_shopifyId: { shop, shopifyId: shopifyProductId } },
    });
    if (!product) continue;

    const flatBom = await flattenBom(shop, product.id, orderQty);
    if (!Object.keys(flatBom).length) continue;

    await deductMaterials(
      shop, flatBom,
      `Order #${order.order_number}`,
      product.name,
      orderQty
    );
  }
}

async function handleOrderCancel(shop, order) {
  for (const item of order.line_items || []) {
    const shopifyProductId = `gid://shopify/Product/${item.product_id}`;
    const orderQty = item.quantity || 1;

    const product = await prisma.product.findUnique({
      where: { shop_shopifyId: { shop, shopifyId: shopifyProductId } },
    });
    if (!product) continue;

    const flatBom = await flattenBom(shop, product.id, orderQty);
    if (!Object.keys(flatBom).length) continue;

    await restoreMaterials(
      shop, flatBom,
      `Cancellation of Order #${order.order_number}`,
      product.name,
      orderQty,
      "CANCEL"
    );
  }
}

async function handleRefund(shop, refund) {
  for (const refundItem of refund.refund_line_items || []) {
    const lineItem = refundItem.line_item;
    if (!lineItem) continue;

    const shopifyProductId = `gid://shopify/Product/${lineItem.product_id}`;
    const refundQty = refundItem.quantity || 1;

    const product = await prisma.product.findUnique({
      where: { shop_shopifyId: { shop, shopifyId: shopifyProductId } },
    });
    if (!product) continue;

    const flatBom = await flattenBom(shop, product.id, refundQty);
    if (!Object.keys(flatBom).length) continue;

    await restoreMaterials(
      shop, flatBom,
      `Refund on Order #${refund.order_id}`,
      product.name,
      refundQty,
      "REFUND"
    );
  }
}
