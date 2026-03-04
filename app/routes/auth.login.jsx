import { login } from "../shopify.server";

export const loader = ({ request }) => login(request);
