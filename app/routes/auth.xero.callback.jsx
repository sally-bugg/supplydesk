import { redirect } from "@remix-run/node";
import { exchangeXeroCode } from "../xero.server";
import { prisma } from "../shopify.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const shop = url.searchParams.get("state");

  if (!code || !shop) {
    return redirect("/app/settings?xero=error");
  }

  try {
    const tokens = await exchangeXeroCode(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.xeroToken.upsert({
      where: { shop },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      },
      create: {
        shop,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      },
    });

    return redirect("/app/settings?xero=connected");
  } catch (err) {
    console.error("Xero callback error:", err);
    return redirect("/app/settings?xero=error");
  }
}
