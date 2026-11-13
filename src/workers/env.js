/** Run-time env helpers. Always read process.env on call; never cache at boot. */
export function envFlag(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function firstEnv(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

/** Master switch WORKERS_ENABLED (default false => existing behaviour unchanged). */
export function workersEnabled() {
  return envFlag("WORKERS_ENABLED", false);
}
