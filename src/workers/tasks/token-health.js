/**
 * TASK: Token / credential health check
 *
 * Purpose:   Detect expired, revoked or missing credentials before they break syncs/webhooks.
 * Schedule:  every WORKER_TOKEN_HEALTH_INTERVAL_MS (default 15 min); first run after jitter.
 * Flow:
 *   1. Re-read SHOPIFY_* / SELLVIA_* from process.env (picks up secrets rotated on Render).
 *   2. GET Shopify Admin `shop.json` and a Sellvia endpoint (SELLVIA_PRODUCTS_URL, else the base URL).
 *      HTTP 401/403 => credential problem. Other non-2xx / network errors are logged as warnings only
 *      (an outage is not proof the token is bad).
 *   3. If Prisma is available, inspect OFFLINE Shopify sessions: flag refresh tokens that are expired
 *      or expiring within WORKER_SESSION_EXPIRY_WARN_MS (the shop must re-authorize). Access tokens are
 *      never selected from the DB.
 * Failure:   Credential findings make the task throw -> scheduler backoff + de-duplicated alert.
 *            No token refresh is attempted: static Shopify Admin tokens cannot be refreshed; they must be
 *            rotated by a human. Secrets are never logged or written to artifacts.
 */
import { requestWithRetry } from "../request.js";
import { resolveStoreDomain } from "../config.js";

const DEFAULT_API_VERSION = "2025-01";
const AUTH_FAILURE = new Set([401, 403]);

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

export function normalizeShopDomain(value) {
  return String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

async function probe(name, url, headers, { request, signal, timeoutMs }) {
  try {
    const { response } = await request(url, { headers, signal }, { timeoutMs, maxRetries: 1, backoffMs: 500 });
    if (response.ok) return { name, status: "ok", httpStatus: response.status };
    if (AUTH_FAILURE.has(response.status)) return { name, status: "unauthorized", httpStatus: response.status };
    return { name, status: "unexpected_status", httpStatus: response.status };
  } catch (error) {
    return { name, status: "unreachable", error: error.message };
  }
}

export async function checkSessions(prisma, { now = new Date(), warnMs }) {
  const sessions = await prisma.session.findMany({
    where: { isOnline: false },
    select: { shop: true, expires: true, refreshToken: true, refreshTokenExpires: true },
  });
  const findings = [];
  const horizon = now.getTime() + warnMs;
  for (const session of sessions) {
    if (session.refreshTokenExpires && session.refreshTokenExpires.getTime() <= horizon) {
      findings.push({ name: `session:${session.shop}`, status: "refresh_token_expiring", expiresAt: session.refreshTokenExpires.toISOString() });
    } else if (session.expires && session.expires.getTime() <= now.getTime() && !session.refreshToken) {
      findings.push({ name: `session:${session.shop}`, status: "expired_without_refresh_token" });
    }
  }
  return { checked: sessions.length, findings };
}

export function createTokenHealthTask({ config, prisma, request = requestWithRetry, env = process.env }) {
  return {
    name: "token-health",
    intervalMs: config.tokenHealth.intervalMs,
    timeoutMs: config.tokenHealth.timeoutMs,
    enabled: config.tokenHealth.enabled,
    async run({ signal, logger }) {
      const problems = [];
      const results = [];
      const opts = { request, signal, timeoutMs: 10000 };

      const shopDomain = normalizeShopDomain(first(env.SHOPIFY_STORE_DOMAIN));
      const shopToken = first(env.SHOPIFY_ADMIN_ACCESS_TOKEN, env.SHOPIFY_API_TOKEN);
      if (!shopDomain || !shopToken) {
        problems.push("shopify:missing_credentials");
      } else {
        const version = env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION;
        results.push(await probe("shopify", `https://${shopDomain}/admin/api/${version}/shop.json`, { "X-Shopify-Access-Token": shopToken }, opts));
      }

      const sellviaKey = first(env.SELLVIA_API_KEY, env.SELLVIA_MASTER_KEY);
      if (!sellviaKey) {
        problems.push("sellvia:missing_credentials");
      } else {
        const base = (env.SELLVIA_API_BASE_URL || "https://api.sellvia.com").replace(/\/$/, "");
        const url = first(env.SELLVIA_PRODUCTS_URL, base);
        results.push(await probe("sellvia", url, { Authorization: ["Bearer", sellviaKey].join(" ") }, opts));
      }

      if (prisma) {
        try {
          const sessions = await checkSessions(prisma, { warnMs: config.tokenHealth.sessionExpiryWarnMs });
          results.push(...sessions.findings);
        } catch (error) {
          logger.warn("token_health_session_check_failed", { error });
        }
      }

      for (const result of results) {
        if (result.status === "ok") continue;
        const bad = result.status === "unauthorized" || result.status === "refresh_token_expiring" || result.status === "expired_without_refresh_token";
        if (bad) {
          problems.push(`${result.name}:${result.status}${result.httpStatus ? `(${result.httpStatus})` : ""}`);
        } else {
          logger.warn("token_health_warning", { result });
        }
      }

      const summary = { store: resolveStoreDomain(env), checks: results.map(({ name, status, httpStatus }) => ({ name, status, httpStatus })) };
      if (problems.length > 0) {
        throw new Error(`Credential health check failed: ${problems.join(", ")}`);
      }
      return summary;
    },
  };
}
