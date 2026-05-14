import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getXeroAuthUrl } from "../xero.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = getXeroAuthUrl(session.shop);
  return redirect(url);
}
