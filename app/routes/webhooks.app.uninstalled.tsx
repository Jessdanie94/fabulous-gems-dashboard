import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger after an app is uninstalled
  // If the app is already uninstalled, the session may be undefined.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
