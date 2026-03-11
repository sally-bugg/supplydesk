import { json } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
}

export default function App() {
  const { apiKey } = useLoaderData();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <ui-nav-menu>
        <a href="/app" rel="home">Dashboard</a>
        <a href="/app/materials">Raw Materials</a>
        <a href="/app/bom">Bill of Materials</a>
        <a href="/app/sub-assemblies">Sub-Assemblies</a>
        <a href="/app/production">Production Runs</a>
        <a href="/app/purchase-orders">Purchase Orders</a>
        <a href="/app/logs">Stock Log</a>
      </ui-nav-menu>
      <Outlet />
    </AppProvider>
  );
}
