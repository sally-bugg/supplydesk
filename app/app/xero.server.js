import { prisma } from "./shopify.server";

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID;
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const XERO_REDIRECT_URI = `${process.env.SHOPIFY_APP_URL}/auth/xero/callback`;

export function getXeroAuthUrl(shop) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID,
    redirect_uri: XERO_REDIRECT_URI,
    scope: "accounting.transactions accounting.contacts offline_access openid profile email",
    state: shop,
  });
  return `https://login.xero.com/identity/connect/authorize?${params}`;
}

async function exchangeToken(body) {
  const credentials = Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  return response.json();
}

export async function exchangeXeroCode(code) {
  return exchangeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: XERO_REDIRECT_URI,
  });
}

async function refreshXeroToken(shop) {
  const token = await prisma.xeroToken.findUnique({ where: { shop } });
  if (!token) throw new Error("No Xero token found");
  const data = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  });
  await prisma.xeroToken.update({
    where: { shop },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });
  return data.access_token;
}

async function getAccessToken(shop) {
  const token = await prisma.xeroToken.findUnique({ where: { shop } });
  if (!token) return null;
  if (new Date() >= token.expiresAt) return refreshXeroToken(shop);
  return token.accessToken;
}

async function getTenantId(accessToken) {
  const response = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const connections = await response.json();
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
  const accessToken = await getAccessToken(shop);
  if (!accessToken) throw new Error("Not connected to Xero");
  const tenantId = await getTenantId(accessToken);
  if (!tenantId) throw new Error("No Xero organisation found");

  const lineItems = po.lines.map((line) => ({
    Description: `${line.material.name} (${line.material.sku}) — ${line.qty} ${line.material.unit}`,
    Quantity: line.qty,
    UnitAmount: line.cost,
    AccountCode: process.env.XERO_PURCHASE_ACCOUNT_CODE || "310",
  }));

  const response = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      Invoices: [{
        Type: "ACCPAY",
        Contact: { Name: po.supplier || "Unknown Supplier" },
        Reference: `PO-${po.id.slice(-6).toUpperCase()}`,
        LineAmountTypes: "Exclusive",
        LineItems: lineItems,
        Status: "DRAFT",
      }],
    }),
  });

  const data = await response.json();
  if (data.Invoices?.[0]?.InvoiceID) {
    return { success: true, invoiceId: data.Invoices[0].InvoiceID };
  }
  throw new Error(JSON.stringify(data));
}
