import { QueueError, fail, object, paymentIntent, eventId, uuid, currency, scope, amount, integer, identifier, newId, tokenHash, safeError } from './validation.js';
const guarded = fn => async (...args) => { try { return await fn(...args); } catch (error) { return safeError(error); } };
const leaseSecondsOf = n => integer(n ?? 60, 'leaseSeconds', 1, 900);
const tokenOf = token => uuid(token, 'leaseToken');
const one = rows => rows[0] ?? null;
const credentialLike = /(?:^|[^A-Za-z0-9])(?:[srp]k_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|(?:secret|password|bearer|token|api[_-]?key)(?:[_.:/-]|$))/i;
function validateRedriveReference(value, name, max) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[^A-Za-z0-9_.:/-]/.test(value) || value.includes('://') || credentialLike.test(value)) fail('INVALID_INPUT', `${name} must be a non-sensitive opaque identifier`);
}
async function lockActiveJob(tx, jobId, leaseToken) {
  const job = one(await tx.$queryRaw`SELECT *, ("leaseExpiresAt" > clock_timestamp()) AS "leaseValid" FROM "StripeJob" WHERE "id" = ${jobId} FOR UPDATE`);
  if (!job || job.status !== 'PROCESSING' || job.leaseToken !== leaseToken || !job.leaseValid) fail('STALE_LEASE', 'Job lease is missing, expired, or no longer current');
  return job;
}
async function lockOperation(tx, operationId) {
  return one(await tx.$queryRaw`SELECT *, ("leaseExpiresAt" > clock_timestamp()) AS "leaseValid" FROM "FulfillmentOperation" WHERE "id" = ${operationId} FOR UPDATE`);
}
async function markNeedsReconciliation(tx, operationId) {
  await tx.$executeRaw`UPDATE "FulfillmentOperation" SET "status" = 'NEEDS_RECONCILIATION', "claimedByJobId" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${operationId} AND "status" = 'IN_FLIGHT'`;
}
async function recoverForJob(tx, jobId) {
  await tx.$executeRaw`UPDATE "FulfillmentOperation" SET "status" = 'NEEDS_RECONCILIATION', "claimedByJobId" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp() WHERE "claimedByJobId" = ${jobId} AND "status" = 'IN_FLIGHT'`;
}
const checkJobArgs = input => { object(input); uuid(input.jobId, 'jobId'); tokenOf(input.leaseToken); };

/** Construction never starts a worker. */
export function createQueue({ prisma } = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') fail('INVALID_INPUT', 'A dedicated Prisma client is required');
  const createOrder = guarded(async input => {
    object(input); scope(input.accountId, input.livemode); identifier(input.externalOrderId, 'externalOrderId');
    const cents = amount(input.amount); currency(input.currency);
    return prisma.$transaction(async tx => {
      const id = newId();
      const inserted = await tx.$queryRaw`INSERT INTO "StripeOrder" ("id", "accountId", "livemode", "externalOrderId", "amount", "currency") VALUES (${id}, ${input.accountId}, ${input.livemode}, ${input.externalOrderId}, ${cents}, ${input.currency}) ON CONFLICT ("accountId", "livemode", "externalOrderId") DO NOTHING RETURNING "id"`;
      const order = await tx.stripeOrder.findUnique({ where: { accountId_livemode_externalOrderId: { accountId: input.accountId, livemode: input.livemode, externalOrderId: input.externalOrderId } } });
      if (!order || order.amount !== cents || order.currency !== input.currency) fail('ORDER_CONFLICT', 'The scoped external order already exists with different immutable terms');
      return { status: inserted.length ? 'CREATED' : 'EXISTS', order };
    });
  });
  const addPaymentIntentMapping = guarded(async input => {
    object(input); uuid(input.orderId, 'orderId'); scope(input.accountId, input.livemode); paymentIntent(input.paymentIntentId);
    return prisma.$transaction(async tx => {
      const order = await tx.stripeOrder.findUnique({ where: { id: input.orderId } });
      if (!order || order.accountId !== input.accountId || order.livemode !== input.livemode) fail('ORDER_SCOPE_MISMATCH', 'Order not found in this account and mode');
      const id = newId();
      const inserted = await tx.$queryRaw`INSERT INTO "PaymentIntentMapping" ("id", "orderId", "accountId", "livemode", "paymentIntentId") VALUES (${id}, ${input.orderId}, ${input.accountId}, ${input.livemode}, ${input.paymentIntentId}) ON CONFLICT ("paymentIntentId") DO NOTHING RETURNING "id"`;
      const mapping = await tx.paymentIntentMapping.findUnique({ where: { paymentIntentId: input.paymentIntentId } });
      if (!mapping || mapping.orderId !== input.orderId || mapping.accountId !== input.accountId || mapping.livemode !== input.livemode) fail('MAPPING_CONFLICT', 'PaymentIntent is already mapped to a different order or scope');
      return { status: inserted.length ? 'CREATED' : 'EXISTS', mapping };
    });
  });
  const ingestVerifiedEvent = guarded(async input => {
    object(input); scope(input.accountId, input.livemode); eventId(input.eventId); paymentIntent(input.paymentIntentId);
    if (input.verified !== true || input.eventType !== 'payment_intent.succeeded' || input.paymentIntentStatus !== 'succeeded') fail('UNVERIFIED_EVENT', 'Only caller-verified payment_intent.succeeded events are accepted');
    const maxAttempts = integer(input.maxAttempts ?? 10, 'maxAttempts', 1, 100);
    return prisma.$transaction(async tx => {
      const inserted = await tx.$queryRaw`INSERT INTO "StripeEvent" ("eventId", "accountId", "livemode", "eventType", "paymentIntentId") VALUES (${input.eventId}, ${input.accountId}, ${input.livemode}, ${input.eventType}, ${input.paymentIntentId}) ON CONFLICT ("eventId") DO NOTHING RETURNING "eventId"`;
      if (inserted.length) {
        const job = await tx.stripeJob.create({ data: { id: newId(), eventId: input.eventId, maxAttempts } });
        return { status: 'CREATED', jobId: job.id };
      }
      const existing = await tx.stripeEvent.findUnique({ where: { eventId: input.eventId } });
      if (!existing || existing.accountId !== input.accountId || existing.livemode !== input.livemode || existing.eventType !== input.eventType || existing.paymentIntentId !== input.paymentIntentId) fail('EVENT_CONFLICT', 'Duplicate event ID has conflicting identity or scope');
      const job = await tx.stripeJob.findUnique({ where: { eventId: input.eventId } });
      if (!job) fail('INTEGRITY_ERROR', 'Existing event has no queue job');
      return { status: 'DUPLICATE', jobId: job.id };
    });
  });


  const claimJob = guarded(async (input = {}) => {
    object(input); const seconds = leaseSecondsOf(input.leaseSeconds);
    return prisma.$transaction(async tx => {
      for (let i = 0; i < 100; i++) {
        const job = one(await tx.$queryRaw`SELECT * FROM "StripeJob" WHERE ("status" = 'PENDING' AND "availableAt" <= clock_timestamp()) OR ("status" = 'PROCESSING' AND "leaseExpiresAt" <= clock_timestamp()) ORDER BY "availableAt", "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`);
        if (!job) return { status: 'EMPTY' };
        if (job.status === 'PROCESSING') await recoverForJob(tx, job.id);
        if (job.attempts >= job.maxAttempts) {
          await tx.$executeRaw`UPDATE "StripeJob" SET "status" = 'DEAD', "leaseToken" = NULL, "leaseExpiresAt" = NULL, "verifiedLeaseToken" = NULL, "verifiedAt" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${job.id}`;
          continue;
        }
        const leaseToken = newId();
        const claimed = one(await tx.$queryRaw`UPDATE "StripeJob" SET "status" = 'PROCESSING', "attempts" = "attempts" + 1, "leaseToken" = ${leaseToken}, "leaseExpiresAt" = clock_timestamp() + (${seconds} * interval '1 second'), "verifiedLeaseToken" = NULL, "verifiedAt" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${job.id} RETURNING *`);
        const event = await tx.stripeEvent.findUnique({ where: { eventId: job.eventId } });
        if (!event) fail('INTEGRITY_ERROR', 'Job has no event');
        return { status: 'CLAIMED', jobId: job.id, eventId: event.eventId, accountId: event.accountId, livemode: event.livemode, paymentIntentId: event.paymentIntentId, attempts: claimed.attempts, maxAttempts: claimed.maxAttempts, leaseToken, leaseExpiresAt: claimed.leaseExpiresAt };
      }
      return { status: 'EMPTY' };
    });
  });
  const renewJob = guarded(async input => {
    checkJobArgs(input); const seconds = leaseSecondsOf(input.leaseSeconds);
    return prisma.$transaction(async tx => {
      await lockActiveJob(tx, input.jobId, input.leaseToken);
      const updated = one(await tx.$queryRaw`UPDATE "StripeJob" SET "leaseExpiresAt" = GREATEST("leaseExpiresAt", clock_timestamp() + (${seconds} * interval '1 second')), "updatedAt" = clock_timestamp() WHERE "id" = ${input.jobId} AND "status" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken} AND "leaseExpiresAt" > clock_timestamp() RETURNING "leaseExpiresAt"`);
      if (!updated) fail('STALE_LEASE', 'Job lease expired before renewal');
      return { status: 'RENEWED', leaseExpiresAt: updated.leaseExpiresAt };
    });
  });
  const retryJob = guarded(async input => {
    checkJobArgs(input); const delay = integer(input.delaySeconds ?? 30, 'delaySeconds', 0, 86400);
    return prisma.$transaction(async tx => {
      const job = await lockActiveJob(tx, input.jobId, input.leaseToken);
      if (job.operationId) {
        const op = await lockOperation(tx, job.operationId);
        if (op?.status === 'IN_FLIGHT' && op.claimedByJobId === job.id) {
          if (!op.leaseValid) { await markNeedsReconciliation(tx, op.id); return { status: 'NEEDS_RECONCILIATION', operationId: op.id }; }
          return { status: 'IN_FLIGHT', operationId: op.id };
        }
        if (op?.status === 'NEEDS_RECONCILIATION') return { status: 'NEEDS_RECONCILIATION', operationId: op.id };
      }
      const status = job.attempts >= job.maxAttempts ? 'DEAD' : 'PENDING';
      const updated = one(await tx.$queryRaw`UPDATE "StripeJob" SET "status" = ${status}, "availableAt" = clock_timestamp() + (${delay} * interval '1 second'), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "verifiedLeaseToken" = NULL, "verifiedAt" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${input.jobId} AND "status" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken} AND "leaseExpiresAt" > clock_timestamp() RETURNING "availableAt"`);
      if (!updated) fail('STALE_LEASE', 'Job lease expired before retry');
      return { status, availableAt: updated.availableAt };
    });
  });
  const redriveDeadJob = guarded(async input => {
    object(input); uuid(input.jobId, 'jobId');
    if (input.confirmed !== true) fail('INVALID_INPUT', 'Explicit confirmed redrive is required');
    validateRedriveReference(input.actor, 'actor', 120);
    validateRedriveReference(input.evidenceReference, 'evidenceReference', 200);
    return prisma.$transaction(async tx => {
      const job = one(await tx.$queryRaw`SELECT * FROM "StripeJob" WHERE "id" = ${input.jobId} FOR UPDATE`);
      if (!job) fail('NOT_FOUND', 'Job not found');
      if (job.status !== 'DEAD') fail('INVALID_STATE', 'Only a DEAD job can be redriven');
      let op;
      if (job.operationId) {
        op = await lockOperation(tx, job.operationId);
        if (!op) fail('INTEGRITY_ERROR', 'Prepared operation is missing');
      } else {
        // Another event for the same mapped order may have created an operation.
        op = one(await tx.$queryRaw`SELECT o.* FROM "StripeEvent" e JOIN "PaymentIntentMapping" m ON m."paymentIntentId" = e."paymentIntentId" AND m."accountId" = e."accountId" AND m."livemode" = e."livemode" JOIN "FulfillmentOperation" o ON o."orderId" = m."orderId" AND o."accountId" = m."accountId" AND o."livemode" = m."livemode" WHERE e."eventId" = ${job.eventId} FOR UPDATE OF o`);
      }
      if (op && (op.status === 'IN_FLIGHT' || op.status === 'NEEDS_RECONCILIATION')) fail('OPERATION_UNRESOLVED', 'Associated operation is in flight or requires reconciliation');
      if (op && !['READY', 'COMPLETED'].includes(op.status)) fail('INTEGRITY_ERROR', 'Unexpected operation state');
      const redriveId = newId();
      await tx.$executeRaw`INSERT INTO "JobRedrive" ("id", "jobId", "actor", "evidenceReference", "priorAttempts", "priorMaxAttempts") VALUES (${redriveId}, ${job.id}, ${input.actor}, ${input.evidenceReference}, ${job.attempts}, ${job.maxAttempts})`;
      const updated = one(await tx.$queryRaw`UPDATE "StripeJob" SET "status" = 'PENDING', "attempts" = 0, "availableAt" = clock_timestamp(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "verifiedLeaseToken" = NULL, "verifiedAt" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${job.id} AND "status" = 'DEAD' RETURNING "availableAt"`);
      if (!updated) fail('INVALID_STATE', 'Job is no longer DEAD');
      return { status: 'REDRIVEN', jobId: job.id, redriveId, availableAt: updated.availableAt };
    });
  });
  const ackJob = guarded(async input => {
    checkJobArgs(input);
    return prisma.$transaction(async tx => {
      const job = await lockActiveJob(tx, input.jobId, input.leaseToken);
      if (!job.operationId) return { status: 'NOT_READY' };
      const op = await lockOperation(tx, job.operationId);
      if (!op) fail('INTEGRITY_ERROR', 'Prepared operation is missing');
      if (op.status === 'IN_FLIGHT' && !op.leaseValid) { await markNeedsReconciliation(tx, op.id); return { status: 'NEEDS_RECONCILIATION', operationId: op.id }; }
      if (op.status !== 'COMPLETED') return { status: op.status, operationId: op.id };
      if (job.verifiedLeaseToken !== input.leaseToken || !job.verifiedAt) fail('PAYMENT_CHECK_REQUIRED', 'Verify the current PaymentIntent for this job lease before acknowledgement');
      const changed = await tx.$executeRaw`UPDATE "StripeJob" SET "status" = 'DONE', "leaseToken" = NULL, "leaseExpiresAt" = NULL, "verifiedLeaseToken" = NULL, "verifiedAt" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${input.jobId} AND "status" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken} AND "leaseExpiresAt" > clock_timestamp()`;
      if (changed !== 1) fail('STALE_LEASE', 'Job lease expired before acknowledgement');
      return { status: 'DONE', operationId: op.id };
    });
  });

  const prepareFulfillment = guarded(async input => {
    checkJobArgs(input);
    if (typeof input.retrievePaymentIntent !== 'function') fail('INVALID_INPUT', 'A trusted server-side retrievePaymentIntent callback is required');
    const context = await prisma.$transaction(async tx => {
      const job = await lockActiveJob(tx, input.jobId, input.leaseToken);
      const event = await tx.stripeEvent.findUnique({ where: { eventId: job.eventId } });
      if (!event) fail('INTEGRITY_ERROR', 'Job has no event');
      const mapping = await tx.paymentIntentMapping.findUnique({ where: { paymentIntentId: event.paymentIntentId } });
      if (!mapping) return { status: 'UNMAPPED' };
      if (mapping.accountId !== event.accountId || mapping.livemode !== event.livemode) fail('MAPPING_SCOPE_MISMATCH', 'PaymentIntent mapping does not match event scope');
      const order = await tx.stripeOrder.findUnique({ where: { id: mapping.orderId } });
      if (!order) fail('INTEGRITY_ERROR', 'Mapped order is missing');
      return { status: 'MAPPED', event, mapping, order };
    });
    if (context.status === 'UNMAPPED') return context;
    let pi;
    try { pi = await input.retrievePaymentIntent({ id: context.event.paymentIntentId, accountId: context.event.accountId, livemode: context.event.livemode }); }
    catch { fail('PAYMENT_RETRIEVAL_FAILED', 'Trusted PaymentIntent retrieval failed'); }
    try {
      object(pi, 'retrieved PaymentIntent'); paymentIntent(pi.id); scope(pi.accountId, pi.livemode); currency(pi.currency);
      const received = amount(pi.amountReceived, 'amountReceived');
      if (pi.status !== 'succeeded' || pi.id !== context.event.paymentIntentId || pi.accountId !== context.event.accountId || pi.livemode !== context.event.livemode || received !== context.order.amount || pi.currency !== context.order.currency) fail('PAYMENT_MISMATCH', 'Current PaymentIntent does not match the immutable order mapping');
    } catch (error) {
      if (error instanceof QueueError && error.code === 'PAYMENT_MISMATCH') throw error;
      fail('PAYMENT_MISMATCH', 'Current PaymentIntent is missing valid matching fields');
    }
    return prisma.$transaction(async tx => {
      await lockActiveJob(tx, input.jobId, input.leaseToken);
      const operationId = newId(); const key = `fulfillment_${newId()}`;
      await tx.$executeRaw`INSERT INTO "FulfillmentOperation" ("id", "orderId", "accountId", "livemode", "sourceMappingId", "idempotencyKey") VALUES (${operationId}, ${context.order.id}, ${context.event.accountId}, ${context.event.livemode}, ${context.mapping.id}, ${key}) ON CONFLICT ("orderId") DO NOTHING`;
      const existing = await tx.fulfillmentOperation.findUnique({ where: { orderId: context.order.id } });
      if (!existing || existing.accountId !== context.event.accountId || existing.livemode !== context.event.livemode) fail('INTEGRITY_ERROR', 'Order fulfillment scope mismatch');
      const op = await lockOperation(tx, existing.id);
      if (op.sourceMappingId !== context.mapping.id) fail('MULTIPLE_SUCCESSFUL_PAYMENTS', 'Another PaymentIntent has already been associated with fulfillment for this order; investigate before proceeding');
      if (op.status === 'IN_FLIGHT' && !op.leaseValid) { await markNeedsReconciliation(tx, op.id); op.status = 'NEEDS_RECONCILIATION'; }
      const updated = await tx.$executeRaw`UPDATE "StripeJob" SET "operationId" = ${op.id}, "verifiedLeaseToken" = ${input.leaseToken}, "verifiedAt" = clock_timestamp(), "updatedAt" = clock_timestamp() WHERE "id" = ${input.jobId} AND "status" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken} AND "leaseExpiresAt" > clock_timestamp()`;
      if (updated !== 1) fail('STALE_LEASE', 'Job lease expired during retrieval');
      return { status: op.status, operationId: op.id, orderId: op.orderId, idempotencyKey: op.idempotencyKey };
    });
  });

  const claimFulfillmentOperation = guarded(async input => {
    checkJobArgs(input); uuid(input.operationId, 'operationId'); const seconds = leaseSecondsOf(input.leaseSeconds);
    if (input.businessSafetyChecked !== true) fail('BUSINESS_CHECK_REQUIRED', 'Integrator must check current charge, refund, dispute, and business eligibility');
    return prisma.$transaction(async tx => {
      const job = await lockActiveJob(tx, input.jobId, input.leaseToken);
      if (job.operationId !== input.operationId || job.verifiedLeaseToken !== input.leaseToken || !job.verifiedAt) fail('PAYMENT_CHECK_REQUIRED', 'Verify the current PaymentIntent for this job lease before claiming');
      const op = await lockOperation(tx, input.operationId);
      if (!op) fail('INTEGRITY_ERROR', 'Operation not found');
      if (op.status === 'IN_FLIGHT') {
        if (!op.leaseValid) { await markNeedsReconciliation(tx, op.id); return { status: 'NEEDS_RECONCILIATION', operationId: op.id }; }
        return { status: 'IN_FLIGHT', operationId: op.id };
      }
      if (op.status !== 'READY') return { status: op.status, operationId: op.id };
      // A reconciliation reset changes updatedAt, invalidating prior PI checks.
      // Compare at PostgreSQL precision, not JavaScript Date millisecond precision.
      const verification = one(await tx.$queryRaw`SELECT (j."verifiedAt" >= o."updatedAt") AS "fresh" FROM "StripeJob" j JOIN "FulfillmentOperation" o ON o."id" = j."operationId" WHERE j."id" = ${job.id} AND o."id" = ${op.id}`);
      if (!verification?.fresh) fail('PAYMENT_CHECK_REQUIRED', 'Reverify the current PaymentIntent after reconciliation');
      const operationToken = newId();
      const claimed = one(await tx.$queryRaw`UPDATE "FulfillmentOperation" SET "status" = 'IN_FLIGHT', "claimedByJobId" = ${job.id}, "leaseToken" = ${operationToken}, "leaseExpiresAt" = LEAST(${job.leaseExpiresAt}, clock_timestamp() + (${seconds} * interval '1 second')), "updatedAt" = clock_timestamp() WHERE "id" = ${op.id} AND "status" = 'READY' AND EXISTS (SELECT 1 FROM "StripeJob" WHERE "id" = ${job.id} AND "status" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken} AND "leaseExpiresAt" > clock_timestamp()) RETURNING "leaseExpiresAt"`);
      if (!claimed) fail('STALE_LEASE', 'Job lease expired before operation claim');
      return { status: 'CLAIMED', operationId: op.id, orderId: op.orderId, idempotencyKey: op.idempotencyKey, operationToken, leaseExpiresAt: claimed.leaseExpiresAt };
    });
  });
  const renewFulfillmentOperation = guarded(async input => {
    checkJobArgs(input); uuid(input.operationId, 'operationId'); uuid(input.operationToken, 'operationToken'); const seconds = leaseSecondsOf(input.leaseSeconds);
    return prisma.$transaction(async tx => {
      const job = await lockActiveJob(tx, input.jobId, input.leaseToken);
      const op = await lockOperation(tx, input.operationId);
      if (!op || op.status !== 'IN_FLIGHT' || op.claimedByJobId !== job.id || op.leaseToken !== input.operationToken || !op.leaseValid) fail('STALE_LEASE', 'Operation lease is missing, expired, or no longer current');
      const renewed = one(await tx.$queryRaw`UPDATE "FulfillmentOperation" SET "leaseExpiresAt" = LEAST(${job.leaseExpiresAt}, GREATEST("leaseExpiresAt", clock_timestamp() + (${seconds} * interval '1 second'))), "updatedAt" = clock_timestamp() WHERE "id" = ${op.id} AND "status" = 'IN_FLIGHT' AND "leaseToken" = ${input.operationToken} AND "leaseExpiresAt" > clock_timestamp() AND EXISTS (SELECT 1 FROM "StripeJob" WHERE "id" = ${job.id} AND "status" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken} AND "leaseExpiresAt" > clock_timestamp()) RETURNING "leaseExpiresAt"`);
      if (!renewed) fail('STALE_LEASE', 'Lease expired before renewal');
      return { status: 'RENEWED', leaseExpiresAt: renewed.leaseExpiresAt };
    });
  });

  const completeFulfillmentOperation = guarded(async input => {
    checkJobArgs(input); uuid(input.operationId, 'operationId'); uuid(input.operationToken, 'operationToken');
    const hash = tokenHash(input.operationToken);
    return prisma.$transaction(async tx => {
      const snapshot = await tx.fulfillmentOperation.findUnique({ where: { id: input.operationId } });
      if (snapshot?.status === 'COMPLETED') {
        if (snapshot.completionTokenHash !== hash) fail('STALE_LEASE', 'Completion token does not match');
        return { status: 'ALREADY_COMPLETED', operationId: input.operationId };
      }
      const job = await lockActiveJob(tx, input.jobId, input.leaseToken);
      const op = await lockOperation(tx, input.operationId);
      if (op?.status === 'COMPLETED') {
        if (op.completionTokenHash !== hash) fail('STALE_LEASE', 'Completion token does not match');
        return { status: 'ALREADY_COMPLETED', operationId: op.id };
      }
      if (!op || op.status !== 'IN_FLIGHT' || op.claimedByJobId !== job.id || op.leaseToken !== input.operationToken || !op.leaseValid) fail('STALE_LEASE', 'Operation lease is missing, expired, or no longer current');
      const updated = await tx.$executeRaw`UPDATE "FulfillmentOperation" SET "status" = 'COMPLETED', "completionTokenHash" = ${hash}, "claimedByJobId" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${op.id} AND "status" = 'IN_FLIGHT' AND "claimedByJobId" = ${job.id} AND "leaseToken" = ${input.operationToken} AND "leaseExpiresAt" > clock_timestamp() AND EXISTS (SELECT 1 FROM "StripeJob" WHERE "id" = ${job.id} AND "status" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken} AND "leaseExpiresAt" > clock_timestamp())`;
      if (updated !== 1) fail('STALE_LEASE', 'Lease expired before completion; reconcile the external outcome');
      return { status: 'COMPLETED', operationId: op.id };
    });
  });

  const markFulfillmentAmbiguous = guarded(async input => {
    checkJobArgs(input); uuid(input.operationId, 'operationId'); uuid(input.operationToken, 'operationToken');
    return prisma.$transaction(async tx => {
      const job = await lockActiveJob(tx, input.jobId, input.leaseToken);
      const op = await lockOperation(tx, input.operationId);
      if (!op || op.status !== 'IN_FLIGHT' || op.claimedByJobId !== job.id || op.leaseToken !== input.operationToken || !op.leaseValid) fail('STALE_LEASE', 'Operation lease is missing, expired, or no longer current');
      const changed = await tx.$executeRaw`UPDATE "FulfillmentOperation" SET "status" = 'NEEDS_RECONCILIATION', "claimedByJobId" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${op.id} AND "status" = 'IN_FLIGHT' AND "leaseToken" = ${input.operationToken} AND "leaseExpiresAt" > clock_timestamp() AND EXISTS (SELECT 1 FROM "StripeJob" WHERE "id" = ${job.id} AND "status" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken} AND "leaseExpiresAt" > clock_timestamp())`;
      if (changed !== 1) fail('STALE_LEASE', 'Lease expired; recover and reconcile the operation');
      return { status: 'NEEDS_RECONCILIATION', operationId: op.id };
    });
  });
  const recoverExpiredOperations = guarded(async (input = {}) => {
    object(input); const limit = integer(input.limit ?? 100, 'limit', 1, 1000);
    return prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw`WITH candidates AS (SELECT "id" FROM "FulfillmentOperation" WHERE "status" = 'IN_FLIGHT' AND "leaseExpiresAt" <= clock_timestamp() ORDER BY "leaseExpiresAt", "id" FOR UPDATE SKIP LOCKED LIMIT ${limit}) UPDATE "FulfillmentOperation" AS op SET "status" = 'NEEDS_RECONCILIATION', "claimedByJobId" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp() FROM candidates WHERE op."id" = candidates."id" AND op."status" = 'IN_FLIGHT' AND op."leaseExpiresAt" <= clock_timestamp() RETURNING op."id"`;
      return { status: 'RECOVERED', count: rows.length, operationIds: rows.map(row => row.id) };
    });
  });
  const reconcileFulfillmentOperation = guarded(async input => {
    object(input); uuid(input.operationId, 'operationId');
    if (input.confirmed !== true || !['CONFIRMED_COMPLETED', 'CONFIRMED_NOT_SENT'].includes(input.decision)) fail('INVALID_INPUT', 'Explicit confirmed reconciliation decision required');
    if (typeof input.actor !== 'string' || !/^[A-Za-z0-9_.:/-]{1,120}$/.test(input.actor) || typeof input.evidenceReference !== 'string' || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(input.evidenceReference)) fail('INVALID_INPUT', 'Opaque actor and evidenceReference identifiers are required');
    return prisma.$transaction(async tx => {
      const op = await lockOperation(tx, input.operationId);
      if (!op) fail('NOT_FOUND', 'Operation not found');
      if (op.status !== 'NEEDS_RECONCILIATION') fail('INVALID_STATE', 'Operation is not awaiting reconciliation');
      const status = input.decision === 'CONFIRMED_COMPLETED' ? 'COMPLETED' : 'READY';
      await tx.fulfillmentReconciliation.create({ data: { id: newId(), operationId: op.id, decision: input.decision, actor: input.actor, evidenceReference: input.evidenceReference } });
      await tx.$executeRaw`UPDATE "FulfillmentOperation" SET "status" = ${status}, "completionTokenHash" = NULL, "updatedAt" = clock_timestamp() WHERE "id" = ${op.id} AND "status" = 'NEEDS_RECONCILIATION'`;
      return { status, operationId: op.id, idempotencyKey: op.idempotencyKey };
    });
  });
  const getJob = guarded(async input => {
    object(input); uuid(input.jobId, 'jobId');
    const job = await prisma.stripeJob.findUnique({ where: { id: input.jobId }, select: { id: true, eventId: true, status: true, attempts: true, maxAttempts: true, availableAt: true, leaseExpiresAt: true, operationId: true, createdAt: true, updatedAt: true } });
    return job ? { status: 'FOUND', job } : { status: 'NOT_FOUND' };
  });
  const getOperation = guarded(async input => {
    object(input); uuid(input.operationId, 'operationId');
    const operation = await prisma.fulfillmentOperation.findUnique({ where: { id: input.operationId }, select: { id: true, orderId: true, accountId: true, livemode: true, idempotencyKey: true, status: true, claimedByJobId: true, leaseExpiresAt: true, createdAt: true, updatedAt: true } });
    return operation ? { status: 'FOUND', operation } : { status: 'NOT_FOUND' };
  });
  return Object.freeze({ createOrder, addPaymentIntentMapping, ingestVerifiedEvent, claimJob, renewJob, retryJob, redriveDeadJob, ackJob, prepareFulfillment, claimFulfillmentOperation, renewFulfillmentOperation, completeFulfillmentOperation, markFulfillmentAmbiguous, recoverExpiredOperations, reconcileFulfillmentOperation, getJob, getOperation });
}
