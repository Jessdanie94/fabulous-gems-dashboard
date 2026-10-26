/**
 * Structured JSON logging for background workers.
 *
 * Every log line is a single JSON object (`ts`, `level`, `msg`, plus fields) so it can be
 * parsed by Render / log drains. All fields pass through {@link redact} first so that
 * tokens, secrets and Authorization headers can never reach the logs.
 */

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /token|secret|authorization|password|passwd|api[-_]?key|master[-_]?key|cookie|credential|webhook[-_]?url|database[-_]?url/i;
const SENSITIVE_ENV_NAME = /token|secret|password|api[-_]?key|master[-_]?key|webhook[-_]?url|database[-_]?url/i;
const INLINE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]+/gi,
  /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
];
const MIN_SECRET_LENGTH = 8;
const MAX_DEPTH = 8;

/** Values of sensitive env vars, re-read on every call so rotated secrets are covered. */
function collectSecretValues(env) {
  const values = [];
  for (const [name, value] of Object.entries(env)) {
    if (SENSITIVE_ENV_NAME.test(name) && typeof value === "string" && value.length >= MIN_SECRET_LENGTH) {
      values.push(value);
    }
  }
  return values;
}

function redactString(input, secrets) {
  let output = input;
  for (const secret of secrets) {
    output = output.split(secret).join(REDACTED);
  }
  for (const pattern of INLINE_PATTERNS) {
    output = output.replace(pattern, (match, prefix) => (prefix ? `${prefix}${REDACTED}@` : REDACTED));
  }
  return output;
}

/**
 * Deeply copy `value`, masking sensitive keys and secret-looking strings.
 * Errors are reduced to `{ name, message, status?, code? }` (no stack, to avoid leaking config).
 */
export function redact(value, env = process.env) {
  const secrets = collectSecretValues(env);
  const seen = new WeakSet();

  const walk = (node, depth) => {
    if (typeof node === "string") return redactString(node, secrets);
    if (node === null || typeof node !== "object") return node;
    if (depth > MAX_DEPTH) return "[Truncated]";
    if (seen.has(node)) return "[Circular]";
    seen.add(node);

    if (node instanceof Error) {
      const out = { name: node.name, message: redactString(String(node.message), secrets) };
      if (node.status !== undefined) out.status = node.status;
      if (node.code !== undefined) out.code = node.code;
      return out;
    }
    if (node instanceof Date) return node.toISOString();
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));

    const out = {};
    for (const [key, child] of Object.entries(node)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : walk(child, depth + 1);
    }
    return out;
  };

  return walk(value, 0);
}

/**
 * @param {{ write?: (line: string) => void, env?: object, now?: () => Date }} [options]
 */
export function createLogger({ write = (line) => console.log(line), env = process.env, now = () => new Date() } = {}) {
  const emit = (level, msg, fields = {}) => {
    const safe = redact({ ts: now().toISOString(), level, msg, ...fields }, env);
    write(JSON.stringify(safe));
  };
  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
