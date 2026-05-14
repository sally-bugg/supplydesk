import { redirect } from "@remix-run/node";
import { getXeroAuthUrl } from "../xero.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return redirect("/app/settings?xero=error");
  return redirect(getXeroAuthUrl(shop));
}
