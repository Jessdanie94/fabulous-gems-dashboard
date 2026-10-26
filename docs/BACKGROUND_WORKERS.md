# Background workers

A small, dependency-free scheduler (`src/workers/`) that keeps credentials, sync state and webhooks healthy.
Everything is **off** unless `BACKGROUND_WORKERS_ENABLED=true`.

## How it works

- Each task is a self-scheduling `setTimeout` loop (no `setInterval`), so runs never overlap. An in-process lock is held until a run actually settles; ticks that find it held are skipped and logged.
- Every tick is wrapped in try/catch. A failing task never crashes the process or other tasks.
- After consecutive failures the delay grows `interval * 2^failures`, capped by `WORKER_MAX_BACKOFF_MS`; success resets it.
- Per-task timeout (aborts the `AbortSignal` passed to the task); scheduling timers are `unref()`ed.
- `SIGTERM`/`SIGINT`: stop scheduling, wait for in-flight tasks up to `WORKERS_SHUTDOWN_TIMEOUT_MS`.
- Logs are single-line JSON (`task`, `outcome`, `attempt`, `durationMs`) passed through a redactor that masks token/secret/Authorization keys, ****** Shopify (shpat_) token strings, and the current value of any secret-looking env var.
- Alerts go to `SYNC_FAILURE_WEBHOOK_URL` (JSON, Slack-compatible `text`), sent with the sync engine's `requestWithRetry`, de-duplicated per key for `WORKER_ALERT_COOLDOWN_MS` (default 1 h).
- Credentials are re-read from `process.env` on every run, so rotated Render secrets are picked up without a restart.

## Tasks

| Task | Purpose | Default schedule | Main env vars | On failure |
| --- | --- | --- | --- | --- |
| `token-health` | Probe Shopify `shop.json` and a Sellvia endpoint; detect 401/403/missing creds; flag offline Shopify sessions whose refresh token is expired/expiring. No refresh is attempted (static Admin tokens can't be refreshed). | 15 min | `WORKER_TOKEN_HEALTH_*`, `WORKER_SESSION_EXPIRY_WARN_MS` | Throws -> backoff + alert. Outages (5xx/network) only warn. |
| `catalog-sync` | Runs existing `runSync` (catalog/inventory/price). **Disabled by default** because the `shopify-sellvia-sync` GitHub Action already runs every 30 min. | 60 min | `WORKER_SYNC_ENABLED`, `WORKER_SYNC_DRY_RUN` (default `true`), `WORKER_SYNC_SCOPE`, all `SYNC_*` | Throws -> backoff + alert. Writes require `WORKER_SYNC_DRY_RUN=false` **and** `SYNC_DRY_RUN=false` plus the existing `SYNC_ENABLE_*` flags and bulk approval (threshold 25). |
| `webhook-retry` | Retry failed webhook deliveries stored in `WebhookEvent`. | 2 min | `WEBHOOK_MAX_ATTEMPTS` (8), `WEBHOOK_RETRY_BASE_MS`, `WEBHOOK_RETRY_MAX_MS`, `WEBHOOK_RETRY_BATCH_SIZE` | Per event: exponential backoff, then `dead` + alert. |
| `store-drift` | Read-only: primary domain equals `STORE_DOMAIN`, 24 h order count, sync freshness (if sync worker enabled), Atom feed parses and links stay on the flagship domain. | 4 h | `WORKER_DRIFT_*`, `SYNC_STALE_AFTER_MS` (3 h), `STORE_DOMAIN`, `STORE_RSS_URL` | Any finding throws -> backoff + alert. |
| `housekeeping` | Prune old sync artifacts and processed/dead webhook rows. | 24 h | `RETENTION_ARTIFACTS_DAYS` (14), `RETENTION_WEBHOOK_DAYS` (30) | Throws -> backoff + alert. |

### Webhook dead-letter flow

`webhooks.app.uninstalled` / `webhooks.app.scopes_update` run an idempotent handler (`src/workers/webhook-handlers.js`). If it throws, the event is upserted into `WebhookEvent` (unique `webhookId` = `X-Shopify-Webhook-Id`) and the route returns 200. The worker then moves it `failed -> processed` or `failed -> failed (nextAttemptAt)` -> `dead`. If persisting itself fails the route errors, so Shopify's own retry still applies.

### Domains

`STORE_DOMAIN` is the public flagship domain (default `fabulousgemsparlor.store`); `STORE_RSS_URL` defaults to `https://${STORE_DOMAIN}/collections/all.atom`. `SHOPIFY_STORE_DOMAIN` remains the `*.myshopify.com` Admin API host, unchanged.

## Deployment

**Separate process (recommended).** `npm run workers`. On Render create a *Background Worker* from the same repo with Build `npm install && npm run build && npm run setup` and Start `npm run workers`, copy the env vars, and set `BACKGROUND_WORKERS_ENABLED=true`. The worker and web service must share the same `DATABASE_URL` for `webhook-retry`/`housekeeping`. Note `prisma/schema.prisma` currently uses a SQLite `file:` URL; a shared database requires pointing the datasource at it.

**In-process.** Set `BACKGROUND_WORKERS_ENABLED=true` and `WORKERS_IN_PROCESS=true` and run `npm run start:server` (`server.js`). The Remix `npm run start` entrypoint does not host workers.

Don't run workers in several instances with the same sync scope unless intended; webhook claims are optimistic, but sync and alert de-duplication are per process.

## Migration

`prisma/migrations/20261026000000_create_webhook_event_table` adds `WebhookEvent`; applied by `npm run setup` (`prisma migrate deploy`).

## Tests

`npm test` (Node's built-in runner).
