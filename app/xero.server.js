import { prisma } from "./shopify.server";

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID;
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const XERO_REDIRECT_URI = `${process.env.SHOPIFY_APP_URL}/auth/xero/callback`;

export function getXeroAuthUrl(shop) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID,
    redirect_uri: XERO_REDIRECT_URI,
    scope: "openid profile email accounting.transactions accounting.contacts",
    state: shop,
  });
  return `https://login.xero.com/identity/connect/authorize?${params}`;
}

export async function exchangeXeroCode(code) {
  const credentials = Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: XERO_REDIRECT_URI,
    }),
  });
  return res.json();
}

async function refreshXeroToken(shop, refreshToken) {
  const credentials = Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await prisma.xeroToken.update({
    where: { shop },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    },
  });
  return data.access_token;
}

async function getValidAccessToken(shop) {
  const token = await prisma.xeroToken.findUnique({ where: { shop } });
  if (!token) return null;
  if (new Date() < token.expiresAt) return token.accessToken;
  return refreshXeroToken(shop, token.refreshToken);
}

async function getTenantId(accessToken) {
  const res = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const connections = await res.json();
  return connections[0]?.tenantId;
}

export async function isXeroConnected(shop) {
  const token = await prisma.xeroToken.findUnique({ where: { shop } });
  return !!token;
}

export async function disconnectXero(shop) {
  await prisma.xeroToken.deleteMany({ where: { shop } });
}

export async function createXeroBill(shop, po) {
  const accessToken = await getValidAccessToken(shop);
  if (!accessToken) throw new Error("Xero not connected");

  const tenantId = await getTenantId(accessToken);
  if (!tenantId) throw new Error("No Xero organisation found");

  const lineItems = po.lines.map((line) => ({
    Description: line.materialName || line.sku || "Material",
    ItemCode: line.sku || undefined,
    Quantity: line.quantity,
    UnitAmount: parseFloat(line.unitCost) || 0,
    AccountCode: "310",
  }));

  const invoice = {
    Type: "ACCPAY",
    Contact: { Name: po.supplier || "Unknown Supplier" },
    LineItems: lineItems,
    Status: "DRAFT",
    Reference: po.id,
    LineAmountTypes: "Exclusive",
  };

  const res = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ Invoices: [invoice] }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.Invoices?.[0];
}
