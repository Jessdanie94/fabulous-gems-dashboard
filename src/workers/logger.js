/**
 * Structured (JSON-lines) logger shared by all background workers.
 * Secret values from known env vars are scrubbed from every emitted string.
 */
const SECRET_ENV_KEYS = [
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_API_TOKEN",
  "SHOPIFY_API_SECRET",
  "SELLVIA_API_KEY",
  "SELLVIA_MASTER_KEY",
  "BRIDGE_AUTH_TOKEN",
  "SYNC_FAILURE_WEBHOOK_URL",
];

// Read at call time so rotated secrets are scrubbed too.
export function redact(text) {
  let out = String(text);
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 6) {
      out = out.split(value).join("[REDACTED]");
    }
  }
  return out;
}

export function createLogger(sink = (line) => process.stdout.write(`${line}\n`)) {
  function emit(level, worker, message, fields = {}) {
    try {
      sink(
        redact(
          JSON.stringify({
            ts: new Date().toISOString(),
            level,
            worker,
            message,
            ...fields,
          }),
        ),
      );
    } catch {
      // Logging must never throw into a worker.
    }
  }
  return {
    info: (worker, message, fields) => emit("info", worker, message, fields),
    warn: (worker, message, fields) => emit("warn", worker, message, fields),
    error: (worker, message, fields) => emit("error", worker, message, fields),
  };
}
