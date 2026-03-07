import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader() {
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
}

export default function AuthLogin() {
  const { apiKey } = useLoaderData();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <div />
    </AppProvider>
  );
}
