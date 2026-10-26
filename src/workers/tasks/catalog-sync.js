/**
 * TASK: Catalog / inventory / price sync
 *
 * Purpose:   Keep Shopify products in step with the Sellvia catalog by invoking the existing
 *            `runSync` engine (src/shopify-sellvia-sync.js).
 * Schedule:  every WORKER_SYNC_INTERVAL_MS (default 60 min). DISABLED by default
 *            (WORKER_SYNC_ENABLED=false) because the "Shopify + Sellvia Sync" GitHub Action already runs
 *            the same sync every 30 minutes; enable only if you move scheduling to the worker.
 * Flow:      resolve options -> runSync({ dryRun, scope }) -> record last-success time (used by drift check).
 * Safety:    ALL existing gates are preserved because the engine enforces them: SYNC_ENABLE_WRITES,
 *            SYNC_ENABLE_PRICE/INVENTORY/ORDER_WRITES and the bulk-approval threshold (25).
 *            On top of that the worker is dry-run unless BOTH WORKER_SYNC_DRY_RUN=false AND
 *            SYNC_DRY_RUN=false are set, so a scheduled run can never mutate the store by accident.
 * Failure:   runSync throws on any failure -> scheduler backoff + de-duplicated alert. The scheduler's
 *            run lock guarantees a still-running sync is never started twice.
 */
import { envBool } from "../config.js";
// eslint-disable-next-line no-restricted-imports
import { runSync } from "../../shopify-sellvia-sync.js";

export const syncState = { lastSuccessAt: null };

/** Options passed to runSync. Exported so tests can assert the dry-run default. */
export function resolveWorkerSyncOptions(config, env = process.env) {
  const dryRun = config.sync.dryRun || envBool(env.SYNC_DRY_RUN, true);
  return { dryRun, scope: env.WORKER_SYNC_SCOPE || env.SYNC_SCOPE || "catalog,inventory,price" };
}

export function createSyncTask({ config, env = process.env, sync = runSync }) {
  return {
    name: "catalog-sync",
    intervalMs: config.sync.intervalMs,
    timeoutMs: config.sync.timeoutMs,
    enabled: config.sync.enabled,
    async run() {
      const options = resolveWorkerSyncOptions(config, env);
      const { summary } = await sync(options);
      syncState.lastSuccessAt = new Date();
      return { dryRun: summary.dryRun, scopes: summary.scopes, created: summary.created, updated: summary.updated, skipped: summary.skipped, failed: summary.failed };
    },
  };
}
