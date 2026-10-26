/**
 * Idempotent webhook handlers shared by the Remix webhook routes and the retry worker.
 * Every handler can safely run multiple times for the same event.
 */

export function normalizeTopic(topic) {
  return String(topic || "").toUpperCase().replace(/[/.]/g, "_");
}

function parsePayload(payload) {
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

const HANDLERS = {
  APP_SCOPES_UPDATE: async (prisma, { shop, payload }) => {
    const current = parsePayload(payload)?.current;
    if (!Array.isArray(current)) throw new Error("scopes_update payload missing `current` scopes");
    await prisma.session.updateMany({ where: { shop, isOnline: false }, data: { scope: current.toString() } });
  },
  APP_UNINSTALLED: async (prisma, { shop }) => {
    await prisma.session.deleteMany({ where: { shop } });
  },
};

export async function handleWebhookEvent(prisma, event) {
  const handler = HANDLERS[normalizeTopic(event.topic)];
  if (!handler) throw new Error(`No handler registered for webhook topic ${event.topic}`);
  await handler(prisma, event);
}
