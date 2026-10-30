/**
 * Sellvia API key management: dynamic retriever, 401 fallback, rotation.
 * Keys are read from env on each call (SELLVIA_API_KEY, legacy SELLVIA_MASTER_KEY,
 * SELLVIA_OLD_API_KEY); a rotated key lives in memory and overrides env until restart.
 * Persist the new key in your host's env settings after rotating.
 */
import crypto from "node:crypto";

const state = { activeKey: null, oldKey: null };

export function maskKey(key) {
  if (!key) return "(unset)";
  const s = String(key);
  if (s.length <= 8) return "****";
  const prefix = s.includes("_") ? `${s.split("_")[0]}_` : s.slice(0, 3);
  return `${prefix}****${s.slice(-4)}`;
}

function log(level, message, fields = {}) {
  console[level === "info" ? "log" : level](JSON.stringify({ ts: new Date().toISOString(), level, component: "sellvia-keys", message, ...fields }));
}

export function getSellviaApiKey() {
  return state.activeKey || process.env.SELLVIA_API_KEY || process.env.SELLVIA_MASTER_KEY || null;
}

export function getOldSellviaApiKey() {
  return state.oldKey || process.env.SELLVIA_OLD_API_KEY || null;
}

export function buildAuthHeaders(key = getSellviaApiKey()) {
  return key ? { Authorization: "Bearer " + key, "X-Sellvia-Key": key } : {};
}

function baseUrl() {
  return (process.env.SELLVIA_API_BASE_URL || "https://api.sellvia.com").replace(/\/$/, "");
}

/** fetch wrapper: on 401 retries once with the old key (if set) and warns that rotation is pending. */
export async function sellviaRequest(pathOrUrl, init = {}, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : `${baseUrl()}${pathOrUrl}`;
  const call = (key) =>
    fetchImpl(url, { ...init, headers: { ...(init.headers || {}), ...buildAuthHeaders(key) }, signal: AbortSignal.timeout(timeoutMs) });

  const key = getSellviaApiKey();
  if (!key) throw new Error("Missing Sellvia API key. Set SELLVIA_API_KEY.");
  let res = await call(key);
  if (res.status !== 401) {
    log("info", "Sellvia API Key verified", { key: maskKey(key), status: res.status });
    return res;
  }
  log("warn", "Sellvia Key Revoked/Unauthorized - action required", { key: `SELLVIA_API_KEY=${maskKey(key)}` });
  const oldKey = getOldSellviaApiKey();
  if (!oldKey || oldKey === key) return res;
  log("warn", "Falling back to SELLVIA_OLD_API_KEY; key rotation is pending", { key: maskKey(oldKey) });
  res = await call(oldKey);
  if (res.status === 401) log("warn", "Sellvia old key also unauthorized - action required", { key: maskKey(oldKey) });
  return res;
}

/**
 * Validates newKey with a lightweight GET (SELLVIA_VERIFY_PATH, default "/"),
 * requiring 200, then swaps it in. With revokeOldKey, the old key is dropped and,
 * if SELLVIA_REVOKE_URL is set, a POST with the old key is sent to it.
 */
export async function rotateSellviaKey(newKey, { revokeOldKey = false, fetchImpl = fetch } = {}) {
  if (typeof newKey !== "string" || newKey.trim().length < 8) {
    return { ok: false, validated: false, swapped: false, error: "new_api_key is missing or too short" };
  }
  newKey = newKey.trim();
  let status;
  try {
    const res = await fetchImpl(`${baseUrl()}${process.env.SELLVIA_VERIFY_PATH || "/"}`, {
      headers: buildAuthHeaders(newKey),
      signal: AbortSignal.timeout(15000),
    });
    status = res.status;
  } catch (error) {
    log("error", "Sellvia key validation request failed", { key: maskKey(newKey), error: String(error.message) });
    return { ok: false, validated: false, swapped: false, error: "validation request failed" };
  }
  if (status !== 200) {
    log("warn", "New Sellvia key rejected; not swapped", { key: maskKey(newKey), status });
    return { ok: false, validated: false, swapped: false, status };
  }

  const previous = getSellviaApiKey();
  state.activeKey = newKey;
  state.oldKey = revokeOldKey ? null : previous && previous !== newKey ? previous : getOldSellviaApiKey();
  let revoked = false;
  if (revokeOldKey && previous && previous !== newKey && process.env.SELLVIA_REVOKE_URL) {
    try {
      const r = await fetchImpl(process.env.SELLVIA_REVOKE_URL, { method: "POST", headers: buildAuthHeaders(previous), signal: AbortSignal.timeout(15000) });
      revoked = r.ok;
    } catch {
      revoked = false;
    }
  }
  log("info", "Sellvia API Key verified and rotated", { key: maskKey(newKey), oldKeyRevoked: revokeOldKey, revokeCallOk: revoked });
  return { ok: true, validated: true, swapped: true, activeKey: maskKey(newKey), oldKeyRetained: Boolean(state.oldKey), oldKeyRevoked: revokeOldKey, revokeCallSucceeded: revoked };
}

export function _resetForTests() {
  state.activeKey = null;
  state.oldKey = null;
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Express-compatible handler for POST /admin/sellvia/rotate-key, guarded by X-Admin-Key == ADMIN_API_KEY. */
export function rotateKeyHandler({ fetchImpl } = {}) {
  return async (req, res) => {
    const admin = process.env.ADMIN_API_KEY;
    if (!admin) return res.status(503).json({ ok: false, error: "ADMIN_API_KEY not configured" });
    const provided = req.get ? req.get("x-admin-key") : req.headers?.["x-admin-key"];
    if (!provided || !safeEqual(provided, admin)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const { new_api_key: newKey, revoke_old_key: revoke } = req.body || {};
    const result = await rotateSellviaKey(newKey, { revokeOldKey: revoke === true, fetchImpl });
    res.status(result.ok ? 200 : result.error ? 400 : 422).json(result);
  };
}
