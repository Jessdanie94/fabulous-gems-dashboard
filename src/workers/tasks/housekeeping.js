/**
 * TASK: Housekeeping
 *
 * Purpose:   Keep disk and DB small.
 * Schedule:  every WORKER_HOUSEKEEPING_INTERVAL_MS (default 24 h).
 * Flow:      1. delete files under the sync artifacts dir (SYNC_ARTIFACTS_DIR) not modified for
 *               RETENTION_ARTIFACTS_DAYS (default 14); never removes directories outside that tree.
 *            2. delete `processed`/`dead` WebhookEvent rows older than RETENTION_WEBHOOK_DAYS (default 30).
 *               Pending `failed`/`processing` rows are never pruned.
 * Failure:   throws on unexpected errors -> backoff + alert.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { WEBHOOK_STATUS } from "../webhook-state.js";

export async function pruneOldFiles(dir, olderThanMs, now = Date.now()) {
  let removed = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += await pruneOldFiles(full, olderThanMs, now);
    } else if (entry.isFile()) {
      const { mtimeMs } = await fs.stat(full);
      if (now - mtimeMs > olderThanMs) {
        await fs.unlink(full);
        removed += 1;
      }
    }
  }
  return removed;
}

export function createHousekeepingTask({ config, prisma, env = process.env }) {
  return {
    name: "housekeeping",
    intervalMs: config.housekeeping.intervalMs,
    timeoutMs: config.housekeeping.timeoutMs,
    enabled: config.housekeeping.enabled,
    async run() {
      const artifactsDir = path.resolve(env.SYNC_ARTIFACTS_DIR || "artifacts/shopify-sellvia-sync");
      const artifactsRemoved = await pruneOldFiles(artifactsDir, config.housekeeping.artifactRetentionMs);
      let webhooksRemoved = 0;
      if (prisma) {
        const cutoff = new Date(Date.now() - config.housekeeping.webhookRetentionMs);
        const result = await prisma.webhookEvent.deleteMany({
          where: { status: { in: [WEBHOOK_STATUS.PROCESSED, WEBHOOK_STATUS.DEAD] }, updatedAt: { lt: cutoff } },
        });
        webhooksRemoved = result.count;
      }
      return { artifactsRemoved, webhooksRemoved };
    },
  };
}
