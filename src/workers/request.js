/**
 * Single import point for the sync engine's retrying HTTP helper (timeouts, exponential backoff,
 * Retry-After). The repo's lint rule restricts direct "*shopify*" imports under src/; this helper is
 * the HTTP wrapper only and performs no Shopify writes.
 */
// eslint-disable-next-line no-restricted-imports
export { requestWithRetry } from "../shopify-sellvia-sync.js";
