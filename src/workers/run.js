/**
 * Standalone worker entrypoint: `npm run workers` (Render Background Worker start command).
 * Loads .env (if present), connects Prisma and starts the scheduler. The process stays alive
 * while any task is scheduled; with BACKGROUND_WORKERS_ENABLED unset/false it exits immediately.
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
// eslint-disable-next-line no-restricted-imports
import { loadEnvFile } from "../shopify-sellvia-sync.js";
import { startWorkers } from "./index.js";

await loadEnvFile(path.resolve(".env"));

const prisma = new PrismaClient();
const handle = startWorkers({ prisma });
if (!handle) {
  await prisma.$disconnect();
} else {
  // Timers are unref()ed, so hold the event loop open until a shutdown signal arrives.
  setInterval(() => {}, 2 ** 30);
}
