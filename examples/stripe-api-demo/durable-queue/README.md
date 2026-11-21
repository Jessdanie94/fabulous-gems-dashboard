# Durable Stripe event queue (isolated example)

A deliberately invoked, server-only ESM library for a **separate PostgreSQL database**. The existing application's SQLite database, Prisma schema, and generated client are untouched. It contains no webhook route, scheduler, running worker, Stripe client, Shopify client, or fulfillment call. Do not use it in browser bundles. It is a persistence and coordination component, not proof that an order is safe to fulfill.

## Setup

Requirements: Node 20.19+ and PostgreSQL. Provision a dedicated PostgreSQL database and restricted application role. Keep its TLS-enabled connection string in a secret manager, exposed to the server **only** as `STRIPE_DATABASE_URL`; do not put it in source, logs, or the existing app's `DATABASE_URL`. The app role needs access to these tables; use a separate migration role with DDL rights and prevent the app role from disabling triggers, truncating, or bypassing these invariants. Test on a disposable, dedicated PostgreSQL database, never production or the existing SQLite database. `livemode` must be an explicit boolean, and account is the canonical actual `acct_...` ID (including for the platform account), not `platform`, blank, or an alias. The trusted route must resolve the correct connected-account or platform account ID independently.

```sh
cd examples/stripe-api-demo/durable-queue
npm ci
# Set STRIPE_DATABASE_URL securely in your shell/environment; never paste it into this project.
npm run generate
npm run validate
npm run migrate:deploy
npm run migrate:deploy  # safe to repeat; Prisma tracks applied migrations
npm run check
# Securely set STRIPE_TEST_DATABASE_URL to the isolated disposable test database first.
export STRIPE_TEST_DATABASE_URL
export STRIPE_QUEUE_ALLOW_TESTS=1
npm test
```

Tests require the disposable database name to contain `test`; they create and drop randomly named temporary schemas. Never point the tests at production or an existing application database. The checked-in `prisma/migrations/.../migration.sql` is applied exactly once by `prisma migrate deploy`, not by manually executing it repeatedly. For future changes, review `npm run migrate:dev -- --name change_name` against a disposable development database, inspect and retain the custom PostgreSQL CHECKs, partial indexes, deferred trigger, and immutability triggers in versioned migration SQL, then deploy through `migrate:deploy`. Prisma schema introspection/diff alone cannot express these custom features; don't let a new migration silently remove them. Backup, access control, maintenance, connection pooling, monitoring, alerting, retention, and incident procedures remain operator duties. Installation pins Prisma/client 6.19.3 and overrides vulnerable tooling dependencies to `deepmerge-ts` 8.0.2 and `effect` 3.22.5. These overrides have been exercised by the local integration suite; reassess them and audit dependencies when upgrading. `generated/client` and `node_modules` are local generated artifacts and ignored. Regenerate the client after changing the schema.

## Server-side integration and trust boundaries

```js
import { createStripePrismaClient, createQueue, QueueError } from './durable-queue/src/index.js';
const prisma = createStripePrismaClient(); // reads STRIPE_DATABASE_URL
const queue = createQueue({ prisma });
// At process shutdown: await prisma.$disconnect();
```

Never ingest unverified request JSON. Deliberately wire an HTTPS route that uses the correct Stripe endpoint secret and signature-verifies the **raw** body with the Stripe SDK before accessing event fields. Verify event type, succeeded object status, actual account ID and explicit event livemode; call `ingestVerifiedEvent` only after verification. A `verified: true` argument is an integrator assertion, not cryptographic verification by this library. With the same event ID and identical persisted identity, duplicate delivery returns `DUPLICATE` and the original job ID. A conflicting account, mode, type, or PaymentIntent returns `EVENT_CONFLICT` and must not be acknowledged as an ordinary duplicate. No raw events, customer details, request bodies, Stripe credentials, or provider response bodies are persisted. Store only non-PII opaque external order IDs and audit references. Never log claim tokens or credentials. Return 2xx only after successful event ingestion/duplicate handling; leave failures retryable according to the route's policy. Authentication and authorization of routes, reconciliation and operators are the integrator's responsibility.

Create the immutable order mapping from a trustworthy server-side order/payment source, not arbitrary client input or an unverified event. PaymentIntent IDs are globally unique within this database; each may belong to only one order and account/mode, while multiple PIs may map to one order. External merchant order IDs are unique within account/mode. Corrections require a separately designed, reviewed migration/operational process; order and mapping changes/deletes are blocked. Prices/amounts are positive PostgreSQL bigint minor units; pass JS `bigint` or canonical decimal strings, not floating point JS numbers. Currency is exactly three lowercase ASCII letters. Do not JSON.stringify bigint without explicitly converting it to a decimal string.

If another PaymentIntent for the same order also succeeds after an operation has been created for the first payment, `prepareFulfillment` raises `MULTIPLE_SUCCESSFUL_PAYMENTS`. Do not acknowledge or fulfill the second payment automatically: investigate the possible duplicate payment and establish an appropriate reconciliation or refund process. The queue does not issue refunds.

For example, trusted server-side checkout code can record an order and bind its PaymentIntent before confirmation:

```js
async function recordOrderAndPayment(queue, { accountId, livemode, orderId, paymentIntentId }) {
  const { order } = await queue.createOrder({
    accountId, livemode, externalOrderId: orderId, amount: '2000', currency: 'cad',
  });
  await queue.addPaymentIntentMapping({
    orderId: order.id, accountId, livemode, paymentIntentId,
  });
  return order.id;
}
```

Only after an endpoint has verified the raw-body signature, checked the permitted account and mode, and confirmed that the snapshot object is a succeeded PaymentIntent, it can durably enqueue its identifying facts:

```js
async function persistVerifiedSuccess(queue, event, trustedAccountId) {
  const pi = event.data.object;
  if (event.type !== 'payment_intent.succeeded' || pi.object !== 'payment_intent' ||
      pi.status !== 'succeeded' || pi.livemode !== event.livemode) {
    throw new Error('Unexpected event or PaymentIntent');
  }
  // trustedAccountId must come from the verified Connect event or the
  // preconfigured and allowlisted platform account, not arbitrary request data.
  return queue.ingestVerifiedEvent({
    verified: true, eventId: event.id, eventType: event.type,
    paymentIntentStatus: pi.status, paymentIntentId: pi.id,
    accountId: trustedAccountId, livemode: event.livemode,
  });
}
```

Return HTTP 2xx only after `persistVerifiedSuccess` resolves as `CREATED` or `DUPLICATE`; the separately operated worker still needs the safety checks below. These examples do not create a webhook endpoint or authorize a fulfillment.

**Required current payment and business checks:** `prepareFulfillment` invokes the trusted, server-only `retrievePaymentIntent({id,accountId,livemode})` callback outside the transaction and compares returned `status`, `id`, `accountId`, `livemode`, `amountReceived`, and `currency` against the immutable order and event before creating or reusing an operation. The callback must retrieve fresh Stripe data for the exact account and mode, populate account context from trusted request context, and convert Stripe's integer amount to bigint/string. Do not return data supplied by a browser or webhook as the current retrieval. Retrieval, authentication, account selection, freshness, and provider availability are the integrator's responsibility.

A PI can remain `succeeded` after a refund or during a dispute; matching status, amount and currency **does not** establish the payment remains safe to fulfill. Before **claiming** and again immediately before any external fulfillment, the integrator must obtain current relevant charge, refund and dispute state in the same trusted account/mode and apply its own business, fraud, cancellation and fulfillment eligibility rules. `businessSafetyChecked: true` is only a required caller attestation; the library does not fetch or evaluate any charge, refund, dispute, or fraud record, does not eliminate races with later changes, and cannot authenticate that assertion. If state is unknown or checks fail, do not claim or fulfill. Implement an independently reviewed freshness/race policy; no library check makes an external action safe by itself.

## API (all methods async; returns `{status, ...}`)

Top-level exports: `QueueError` (`code` and safe message), `createStripePrismaClient({databaseUrl?})`, and `createQueue({prisma})`. Every `queue` method takes one object except optional-argument methods, as follows. A storage error is returned as a generic `QueueError` without SQL/credentials/provider payload. A callback error is `PAYMENT_RETRIEVAL_FAILED`. Invalid data throws `INVALID_INPUT` or the documented conflict code. `Date` values are UTC timestamps, lease decisions use the PostgreSQL clock.

| Method and arguments | Result / behavior |
|---|---|
| `createOrder({accountId, livemode, externalOrderId, amount, currency})` | `CREATED`/`EXISTS`, `order`; mismatched immutable terms: `ORDER_CONFLICT`. |
| `addPaymentIntentMapping({orderId, accountId, livemode, paymentIntentId})` | `CREATED`/`EXISTS`, `mapping`; scope/mapping conflicts fail closed. |
| `ingestVerifiedEvent({verified:true,eventId,eventType:'payment_intent.succeeded',paymentIntentStatus:'succeeded',paymentIntentId,accountId,livemode,maxAttempts?})` | Atomically inserts event and exactly one job; `CREATED`/`DUPLICATE`, `jobId`. Default max attempts 10; range 1–100. Re-delivery cannot change the original retry limit. |
| `claimJob({leaseSeconds?})` | `EMPTY` or `CLAIMED` plus `jobId`, event/scope, attempts, `leaseToken`, `leaseExpiresAt`; default 60 seconds, range 1–900. Uses `FOR UPDATE SKIP LOCKED`, new random token each claim, attempts increment on each claim. |
| `renewJob({jobId,leaseToken,leaseSeconds?})` | `RENEWED` + expiry; a current unexpired token is required. |
| `retryJob({jobId,leaseToken,delaySeconds?})` | `PENDING` (default delay 30, range 0–86400) or `DEAD` after the last claim; never requeues an unresolved operation: returns `IN_FLIGHT`/`NEEDS_RECONCILIATION` instead. |
| `redriveDeadJob({jobId,confirmed:true,actor,evidenceReference})` | Explicit, authorization-sensitive operator action after investigation. Returns `{status:'REDRIVEN',jobId,redriveId,availableAt}`; atomically records an immutable audit row with prior attempts and limit and resets the `DEAD` job to `PENDING`, with attempts 0 and all lease/verification fields cleared. Preserves event identity, operation link and `maxAttempts`. `NOT_FOUND` for a missing job, `INVALID_STATE` for a non-DEAD job, and `OPERATION_UNRESOLVED` for an associated `IN_FLIGHT` or `NEEDS_RECONCILIATION` operation. It also checks an operation linked through the event's mapped order. |
| `prepareFulfillment({jobId,leaseToken,retrievePaymentIntent})` | `UNMAPPED` without discarding the job; call `retryJob` with bounded delay, or investigate when dead-lettered. Otherwise returns operation `READY`, `IN_FLIGHT`, `NEEDS_RECONCILIATION` or `COMPLETED` plus `operationId`, `orderId`, `idempotencyKey`. Retrieval must occur again for each newly claimed job lease. |
| `claimFulfillmentOperation({jobId,leaseToken,operationId,businessSafetyChecked:true,leaseSeconds?})` | After trusted checks: `CLAIMED` with a random `operationToken`, stable order-level `idempotencyKey` and expiry, or existing operation status. Only one operation per order. Operation lease never exceeds the job lease. |
| `renewFulfillmentOperation({jobId,leaseToken,operationId,operationToken,leaseSeconds?})` | `RENEWED` + expiry; both tokens must be current and unexpired. Renew the job first if more time is needed. |
| `completeFulfillmentOperation({jobId,leaseToken,operationId,operationToken})` | Only after independently confirmed external success: `COMPLETED`. Repeating the same successful operation token returns `ALREADY_COMPLETED`, including after job acknowledgment; another token fails. No request is sent by this library. |
| `markFulfillmentAmbiguous({jobId,leaseToken,operationId,operationToken})` | With both current tokens, records `NEEDS_RECONCILIATION` when success is unknown (including timeout, lost response or uncertain local commit). |
| `recoverExpiredOperations({limit?})` | Explicit sweep: up to 100 (max 1000) expired `IN_FLIGHT` records become `NEEDS_RECONCILIATION`; `RECOVERED`, `count`, `operationIds`. No resend. Expired job recovery also marks its in-flight operation for reconciliation. |
| `reconcileFulfillmentOperation({operationId,decision,confirmed:true,actor,evidenceReference})` | Restricted operator action only on `NEEDS_RECONCILIATION`; `CONFIRMED_COMPLETED` → `COMPLETED` or `CONFIRMED_NOT_SENT` → `READY`. Writes an immutable audit row. Actor and evidence references are opaque identifiers, not secrets or personal data. |
| `ackJob({jobId,leaseToken})` | `DONE` only if its prepared operation is `COMPLETED` and `prepareFulfillment` verified the PI for this current lease; otherwise `NOT_READY`, the operation status, or `PAYMENT_CHECK_REQUIRED`. This applies to all jobs, not only redriven jobs. Cannot discard an unmapped job. |
| `getJob({jobId})`, `getOperation({operationId})` | `FOUND` + sanitized object or `NOT_FOUND`; never returns lease tokens. |

`retryJob`, `renewJob`, `ackJob`, operation renewal and first completion reject an expired, wrong, or superseded token as `STALE_LEASE`. A timed-out action is **not evidence that it was unsent**. Leases fence database transitions, not requests already in flight at a remote service. Exactly-once external effects cannot be guaranteed. Even a stable provider idempotency key may have provider-specific scope and expiration, and must not be treated as proof that the operation is safe to resend. A crashed or expired operation is marked `NEEDS_RECONCILIATION`, never automatically claimed again. First quiesce/fence the old worker and its network requests; independently investigate provider records. The authorized operator may choose `CONFIRMED_NOT_SENT` only with conclusive evidence **no request was sent and no old worker can send it** (not merely absence in a search result, timeout, or passage of time), or `CONFIRMED_COMPLETED` only with conclusive evidence of completion. If uncertain, leave it in reconciliation. Resetting to `READY` requires a new current PI retrieval, new business checks and a new explicit claim; there is no automatic worker here.

Redrive never sends, claims, changes or reconciles an operation. Investigate and quiesce old workers first; unresolved operations must be reconciled separately, and uncertainty is not evidence of non-send. After redrive, a new job claim and fresh `prepareFulfillment` PI retrieval are required; `READY` additionally requires fresh business checks and an explicit operation claim, while `COMPLETED` is only acknowledged, never fulfilled again. A different worker can change an operation after redrive, so check its current state again when preparing/claiming. The caller must authenticate and authorize the operator and decide whether redrive is justified; `confirmed:true` is only an assertion, not authorization. Actor (1–120 characters) and evidence reference (1–200) are opaque ASCII identifiers using letters, digits, `_ . : / -`; no URLs, personal data, credentials, tokens, secrets, or raw evidence. Common credential-like forms are rejected, but format checks cannot prove an identifier is non-sensitive. Audit rows are immutable against updates/deletes; database privileges must also block truncation and trigger bypass.

Suggested intentional worker flow: claim job → prepare with trusted current retrieval → on `UNMAPPED` retry with delay → check current charges/refunds/disputes and business rules → claim operation → only if separately authorized, perform an external action using the returned stable key and appropriate provider safeguards → record definitive success with completion, or mark ambiguity → acknowledge only after completion. A worker encountering `IN_FLIGHT` or `NEEDS_RECONCILIATION` must not send. Monitor dead letters, expired operations, discrepancies and reconciliation backlog; bounded retries eventually dead-letter even if mapping has not yet arrived. No operator interface or retention policy is supplied. Application role access itself is security-sensitive: raw SQL or privileged schema changes can bypass library-level token fencing.
