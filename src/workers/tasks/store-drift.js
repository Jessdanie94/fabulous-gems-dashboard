/**
 * TASK: Store-state / drift reconciliation (READ-ONLY)
 *
 * Purpose:   Detect when the live store state drifts from what we expect.
 * Schedule:  every WORKER_DRIFT_INTERVAL_MS (default 4 h).
 * Flow (GET requests only, credentials re-read from env each run):
 *   1. shop.json: the primary domain must equal the flagship domain (STORE_DOMAIN, default
 *      fabulousgemsparlor.store). Note SHOPIFY_STORE_DOMAIN remains the *.myshopify.com Admin domain.
 *   2. orders/count.json for the last 24 h (informational; logged, failure is a warning).
 *   3. Sync freshness (only if WORKER_SYNC_ENABLED): last successful sync (in-memory or the engine's
 *      artifacts/.../details.json) older than SYNC_STALE_AFTER_MS (default 3 h) => stale.
 *   4. Optional feed check (WORKER_DRIFT_FEED_CHECK_ENABLED): STORE_RSS_URL (default
 *      https://<STORE_DOMAIN>/collections/all.atom) must fetch, look like Atom/RSS, and every link must
 *      stay on the flagship domain.
 * Failure:   Any drift finding throws -> backoff + de-duplicated alert. Nothing is ever written to Shopify.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { requestWithRetry } from "../request.js";
import { resolveRssUrl, resolveStoreDomain } from "../config.js";
import { normalizeShopDomain } from "./token-health.js";
import { syncState } from "./catalog-sync.js";

const DAY_MS = 86400000;

/** Lightweight Atom/RSS validation without an XML dependency. Returns a list of problems. */
export function validateFeed(xml, storeDomain) {
  const problems = [];
  const isAtom = /<feed[\s>]/i.test(xml) && /<\/feed>\s*$/i.test(xml.trim());
  const isRss = /<rss[\s>]/i.test(xml) && /<\/rss>\s*$/i.test(xml.trim());
  if (!isAtom && !isRss) return ["feed_not_parseable"];

  const links = [
    ...[...xml.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...xml.matchAll(/<link>\s*([^<\s]+)\s*<\/link>/gi)].map((m) => m[1]),
  ];
  const allowed = new Set([storeDomain, `www.${storeDomain}`]);
  for (const link of links) {
    try {
      if (!allowed.has(new URL(link).hostname)) problems.push(`feed_link_off_domain:${new URL(link).hostname}`);
    } catch {
      problems.push("feed_link_invalid");
    }
  }
  return [...new Set(problems)];
}

export async function readLastSyncSuccess(artifactsDir) {
  try {
    const details = JSON.parse(await fs.readFile(path.join(artifactsDir, "details.json"), "utf8"));
    if (details.fatal || (details.errors || []).length > 0 || !details.completedAt) return null;
    return new Date(details.completedAt);
  } catch {
    return null;
  }
}

export function createDriftTask({ config, request = requestWithRetry, env = process.env, startedAt = Date.now() }) {
  return {
    name: "store-drift",
    intervalMs: config.drift.intervalMs,
    timeoutMs: config.drift.timeoutMs,
    enabled: config.drift.enabled,
    async run({ signal, logger }) {
      const findings = [];
      const storeDomain = resolveStoreDomain(env);
      const opts = { timeoutMs: 10000, maxRetries: 1, backoffMs: 500 };
      const summary = { storeDomain };

      const shopDomain = normalizeShopDomain(env.SHOPIFY_STORE_DOMAIN);
      const token = env.SHOPIFY_ADMIN_ACCESS_TOKEN || env.SHOPIFY_API_TOKEN;
      if (shopDomain && token) {
        const base = `https://${shopDomain}/admin/api/${env.SHOPIFY_API_VERSION || "2025-01"}`;
        const headers = { "X-Shopify-Access-Token": token };
        try {
          const { response } = await request(`${base}/shop.json`, { headers, signal }, opts);
          if (response.ok) {
            const { shop } = await response.json();
            summary.primaryDomain = shop?.domain;
            if (shop?.domain && shop.domain !== storeDomain) findings.push(`domain_mismatch:${shop.domain}`);
          } else {
            logger.warn("drift_shop_unavailable", { httpStatus: response.status });
          }
          const since = new Date(Date.now() - DAY_MS).toISOString();
          const orders = await request(`${base}/orders/count.json?status=any&created_at_min=${encodeURIComponent(since)}`, { headers, signal }, opts);
          if (orders.response.ok) summary.ordersLast24h = (await orders.response.json()).count;
        } catch (error) {
          logger.warn("drift_shopify_check_failed", { error });
        }
      } else {
        logger.warn("drift_shopify_skipped", { reason: "missing Shopify credentials" });
      }

      if (config.sync.enabled) {
        const artifactsDir = path.resolve(env.SYNC_ARTIFACTS_DIR || "artifacts/shopify-sellvia-sync");
        const fromDisk = await readLastSyncSuccess(artifactsDir);
        const last = [syncState.lastSuccessAt, fromDisk].filter(Boolean).sort((a, b) => b - a)[0];
        summary.lastSyncAt = last?.toISOString() ?? null;
        const age = last ? Date.now() - last.getTime() : Date.now() - startedAt;
        if (age > config.drift.syncStaleAfterMs) findings.push(last ? "sync_stale" : "sync_never_succeeded");
      }

      if (config.drift.feedCheckEnabled) {
        const feedUrl = resolveRssUrl(env);
        try {
          const { response } = await request(feedUrl, { signal }, opts);
          if (!response.ok) {
            findings.push(`feed_http_${response.status}`);
          } else {
            findings.push(...validateFeed(await response.text(), storeDomain));
          }
        } catch (error) {
          findings.push("feed_unreachable");
          logger.warn("drift_feed_failed", { error });
        }
      }

      if (findings.length > 0) throw new Error(`Store drift detected: ${findings.join(", ")}`);
      return summary;
    },
  };
}
