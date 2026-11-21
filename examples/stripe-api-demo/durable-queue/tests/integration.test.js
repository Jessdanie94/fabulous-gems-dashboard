import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createQueue, createStripePrismaClient } from '../src/index.js';

// These integration tests create and drop isolated schemas. Never point them at
// a live database. Both the explicit opt-in and a test-like database name are
// required before any SQL is executed.
const databaseUrl = process.env.STRIPE_TEST_DATABASE_URL;
if (process.env.STRIPE_QUEUE_ALLOW_TESTS !== '1' || !databaseUrl) {
  throw new Error('Set STRIPE_QUEUE_ALLOW_TESTS=1 and STRIPE_TEST_DATABASE_URL to a disposable test database.');
}
const parsedUrl = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) || !/test/i.test(parsedUrl.pathname)) {
  throw new Error('Refusing to run: PostgreSQL database name must contain "test".');
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const prismaCli = join(root, 'node_modules', '.bin', 'prisma');
const random = () => randomUUID().replaceAll('-', '');
const opaque = prefix => `${prefix}_${random()}`;

async function fixture(t) {
  const schema = `queue_test_${random()}`;
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schema);
  execFileSync(prismaCli, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root,
    env: { ...process.env, STRIPE_DATABASE_URL: scoped.toString() },
    stdio: 'pipe',
  });
  const prisma = createStripePrismaClient({ databaseUrl: scoped.toString() });
  const queue = createQueue({ prisma });
  t.after(async () => {
    try {
      // Schema name comes only from a fixed prefix and a generated hex UUID.
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  });
  return { prisma, queue };
}

function facts(overrides = {}) {
  return {
    verified: true,
    eventId: opaque('evt'),
    eventType: 'payment_intent.succeeded',
    paymentIntentStatus: 'succeeded',
    paymentIntentId: opaque('pi'),
    accountId: opaque('acct'),
    livemode: false,
    ...overrides,
  };
}
async function setupOrder(queue, event, amount = '2000') {
  const result = await queue.createOrder({
    accountId: event.accountId, livemode: event.livemode,
    externalOrderId: `order-${random()}`, amount, currency: 'cad',
  });
  await queue.addPaymentIntentMapping({
    orderId: result.order.id, accountId: event.accountId,
    livemode: event.livemode, paymentIntentId: event.paymentIntentId,
  });
  return result.order;
}
function retrieval(event, override = {}) {
  return async () => ({
    id: event.paymentIntentId, accountId: event.accountId, livemode: event.livemode,
    status: 'succeeded', amountReceived: '2000', currency: 'cad', ...override,
  });
}
async function rejectCode(promise, code) {
  await assert.rejects(promise, error => error?.name === 'QueueError' && error.code === code);
}

test('concurrent duplicate events persist exactly one event and job', async t => {
  const { prisma, queue } = await fixture(t);
  const event = facts();
  const results = await Promise.all(Array.from({ length: 8 }, () => queue.ingestVerifiedEvent(event)));
  assert.equal(results.filter(x => x.status === 'CREATED').length, 1);
  assert.equal(results.filter(x => x.status === 'DUPLICATE').length, 7);
  assert.equal(new Set(results.map(x => x.jobId)).size, 1);
  assert.equal(await prisma.stripeEvent.count(), 1);
  assert.equal(await prisma.stripeJob.count(), 1);
  await rejectCode(queue.ingestVerifiedEvent({ ...event, paymentIntentId: opaque('pi') }), 'EVENT_CONFLICT');
  await rejectCode(queue.ingestVerifiedEvent(facts({ verified: false })), 'UNVERIFIED_EVENT');
  await assert.rejects(prisma.stripeEvent.create({ data: {
    eventId: opaque('evt'), accountId: event.accountId, livemode: false,
    eventType: 'payment_intent.succeeded', paymentIntentId: opaque('pi'),
  } })); // deferred DB constraint: an event must commit with a job
  assert.equal(await prisma.stripeEvent.count(), 1);
});

test('orders and PaymentIntent mappings enforce immutable scope and amounts', async t => {
  const { prisma, queue } = await fixture(t);
  const event = facts();
  const orderInput = { accountId: event.accountId, livemode: false, externalOrderId: `shopify-${random()}`, amount: '2000', currency: 'cad' };
  const first = await queue.createOrder(orderInput);
  assert.equal((await queue.createOrder(orderInput)).status, 'EXISTS');
  await rejectCode(queue.createOrder({ ...orderInput, amount: '2001' }), 'ORDER_CONFLICT');
  await rejectCode(queue.createOrder({ ...orderInput, externalOrderId: `other-${random()}`, amount: 20.99 }), 'INVALID_INPUT');
  await rejectCode(queue.addPaymentIntentMapping({ orderId: first.order.id, accountId: opaque('acct'), livemode: false, paymentIntentId: event.paymentIntentId }), 'ORDER_SCOPE_MISMATCH');
  await rejectCode(queue.addPaymentIntentMapping({ orderId: first.order.id, accountId: event.accountId, livemode: true, paymentIntentId: event.paymentIntentId }), 'ORDER_SCOPE_MISMATCH');
  const input = { orderId: first.order.id, accountId: event.accountId, livemode: false, paymentIntentId: event.paymentIntentId };
  assert.equal((await queue.addPaymentIntentMapping(input)).status, 'CREATED');
  assert.equal((await queue.addPaymentIntentMapping(input)).status, 'EXISTS');
  assert.equal((await queue.addPaymentIntentMapping({ ...input, paymentIntentId: opaque('pi') })).status, 'CREATED');
  const other = await queue.createOrder({ ...orderInput, externalOrderId: `other-${random()}` });
  await rejectCode(queue.addPaymentIntentMapping({ ...input, orderId: other.order.id }), 'MAPPING_CONFLICT');
  await assert.rejects(prisma.stripeOrder.update({ where: { id: first.order.id }, data: { amount: 1n } }));
});

test('concurrent claimers and fencing tokens prevent duplicate active claims', async t => {
  const { queue } = await fixture(t);
  await queue.ingestVerifiedEvent(facts({ maxAttempts: 2 }));
  const results = await Promise.all(Array.from({ length: 8 }, () => queue.claimJob({ leaseSeconds: 30 })));
  const claimed = results.filter(x => x.status === 'CLAIMED');
  assert.equal(claimed.length, 1);
  assert.equal(results.filter(x => x.status === 'EMPTY').length, 7);
  const job = claimed[0];
  await rejectCode(queue.retryJob({ jobId: job.jobId, leaseToken: randomUUID(), delaySeconds: 0 }), 'STALE_LEASE');
  assert.equal((await queue.retryJob({ jobId: job.jobId, leaseToken: job.leaseToken, delaySeconds: 0 })).status, 'PENDING');
  const next = await queue.claimJob({ leaseSeconds: 30 });
  assert.equal(next.attempts, 2);
  assert.notEqual(next.leaseToken, job.leaseToken);
  await rejectCode(queue.ackJob({ jobId: job.jobId, leaseToken: job.leaseToken }), 'STALE_LEASE');
  assert.equal((await queue.retryJob({ jobId: next.jobId, leaseToken: next.leaseToken, delaySeconds: 0 })).status, 'DEAD');
});

test('unmapped and mismatched payments do not prepare fulfillment', async t => {
  const { prisma, queue } = await fixture(t);
  const event = facts();
  await queue.ingestVerifiedEvent(event);
  const job = await queue.claimJob({ leaseSeconds: 30 });
  let called = false;
  const result = await queue.prepareFulfillment({ jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: async () => { called = true; } });
  assert.equal(result.status, 'UNMAPPED');
  assert.equal(called, false);
  await setupOrder(queue, event);
  await rejectCode(queue.prepareFulfillment({ jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: retrieval(event, { amountReceived: '1999' }) }), 'PAYMENT_MISMATCH');
  await rejectCode(queue.prepareFulfillment({ jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: retrieval(event, { currency: 'usd' }) }), 'PAYMENT_MISMATCH');
  await rejectCode(queue.prepareFulfillment({ jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: retrieval(event, { livemode: true }) }), 'PAYMENT_MISMATCH');
  assert.equal(await prisma.fulfillmentOperation.count(), 0);
  const prepared = await queue.prepareFulfillment({ jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: retrieval(event) });
  assert.equal(prepared.status, 'READY');
  await rejectCode(queue.claimFulfillmentOperation({ jobId: job.jobId, leaseToken: job.leaseToken, operationId: prepared.operationId, businessSafetyChecked: false }), 'BUSINESS_CHECK_REQUIRED');
});

test('one order has one operation even with multiple events', async t => {
  const { prisma, queue } = await fixture(t);
  const event = facts();
  await setupOrder(queue, event);
  await queue.ingestVerifiedEvent(event);
  await queue.ingestVerifiedEvent({ ...event, eventId: opaque('evt') });
  const first = await queue.claimJob({ leaseSeconds: 30 });
  const second = await queue.claimJob({ leaseSeconds: 30 });
  const prepare = job => queue.prepareFulfillment({ jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: retrieval(event) });
  const [op1, op2] = await Promise.all([prepare(first), prepare(second)]);
  assert.equal(op1.operationId, op2.operationId);
  assert.equal(await prisma.fulfillmentOperation.count(), 1);
  const dispatch = await queue.claimFulfillmentOperation({ jobId: first.jobId, leaseToken: first.leaseToken, operationId: op1.operationId, businessSafetyChecked: true });
  assert.equal(dispatch.status, 'CLAIMED');
  assert.equal((await queue.claimFulfillmentOperation({ jobId: second.jobId, leaseToken: second.leaseToken, operationId: op2.operationId, businessSafetyChecked: true })).status, 'IN_FLIGHT');
  await rejectCode(queue.completeFulfillmentOperation({ jobId: first.jobId, leaseToken: first.leaseToken, operationId: op1.operationId, operationToken: randomUUID() }), 'STALE_LEASE');
  const complete = { jobId: first.jobId, leaseToken: first.leaseToken, operationId: op1.operationId, operationToken: dispatch.operationToken };
  assert.equal((await queue.completeFulfillmentOperation(complete)).status, 'COMPLETED');
  assert.equal((await queue.completeFulfillmentOperation(complete)).status, 'ALREADY_COMPLETED');
  assert.equal((await queue.ackJob({ jobId: first.jobId, leaseToken: first.leaseToken })).status, 'DONE');
  assert.equal((await queue.ackJob({ jobId: second.jobId, leaseToken: second.leaseToken })).status, 'DONE');
});

test('expired external operation requires explicit reconciliation and re-verification', async t => {
  const { prisma, queue } = await fixture(t);
  const event = facts();
  await setupOrder(queue, event);
  await queue.ingestVerifiedEvent(event);
  const job = await queue.claimJob({ leaseSeconds: 30 });
  const input = { jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: retrieval(event) };
  const op = await queue.prepareFulfillment(input);
  const claimInput = { jobId: job.jobId, leaseToken: job.leaseToken, operationId: op.operationId, businessSafetyChecked: true, leaseSeconds: 1 };
  const dispatch = await queue.claimFulfillmentOperation(claimInput);
  await new Promise(resolve => setTimeout(resolve, 1150));
  assert.equal((await queue.recoverExpiredOperations()).count, 1);
  await rejectCode(queue.completeFulfillmentOperation({ jobId: job.jobId, leaseToken: job.leaseToken, operationId: op.operationId, operationToken: dispatch.operationToken }), 'STALE_LEASE');
  assert.equal((await queue.claimFulfillmentOperation(claimInput)).status, 'NEEDS_RECONCILIATION');
  await rejectCode(queue.reconcileFulfillmentOperation({ operationId: op.operationId, decision: 'CONFIRMED_NOT_SENT', confirmed: false, actor: 'operator', evidenceReference: 'audit-1' }), 'INVALID_INPUT');
  assert.equal((await queue.reconcileFulfillmentOperation({ operationId: op.operationId, decision: 'CONFIRMED_NOT_SENT', confirmed: true, actor: 'operator', evidenceReference: 'audit-1' })).status, 'READY');
  await rejectCode(queue.claimFulfillmentOperation(claimInput), 'PAYMENT_CHECK_REQUIRED');
  await queue.prepareFulfillment(input);
  const again = await queue.claimFulfillmentOperation(claimInput);
  assert.equal(again.status, 'CLAIMED');
  assert.equal((await queue.markFulfillmentAmbiguous({ jobId: job.jobId, leaseToken: job.leaseToken, operationId: op.operationId, operationToken: again.operationToken })).status, 'NEEDS_RECONCILIATION');
  assert.equal((await queue.reconcileFulfillmentOperation({ operationId: op.operationId, decision: 'CONFIRMED_COMPLETED', confirmed: true, actor: 'operator', evidenceReference: 'audit-2' })).status, 'COMPLETED');
  assert.equal((await queue.ackJob({ jobId: job.jobId, leaseToken: job.leaseToken })).status, 'DONE');
  assert.equal(await prisma.fulfillmentReconciliation.count(), 2);
});

test('dead letters require explicit audited redrive; partial verification fails database checks', async t => {
  const { prisma, queue } = await fixture(t);
  const event = facts({ maxAttempts: 1 });
  await queue.ingestVerifiedEvent(event);
  const job = await queue.claimJob({ leaseSeconds: 30 });
  assert.equal((await queue.prepareFulfillment({ jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: retrieval(event) })).status, 'UNMAPPED');
  assert.equal((await queue.retryJob({ jobId: job.jobId, leaseToken: job.leaseToken, delaySeconds: 0 })).status, 'DEAD');
  await assert.rejects(prisma.$executeRaw`UPDATE "StripeJob" SET "verifiedAt" = clock_timestamp() WHERE "id" = ${job.jobId}`);
  await rejectCode(queue.redriveDeadJob({ jobId: job.jobId, confirmed: false, actor: 'operator', evidenceReference: 'case-1' }), 'INVALID_INPUT');
  const redriven = await queue.redriveDeadJob({ jobId: job.jobId, confirmed: true, actor: 'operator', evidenceReference: 'case-1' });
  assert.equal(redriven.status, 'REDRIVEN');
  const again = await queue.claimJob({ leaseSeconds: 30 });
  assert.equal(again.jobId, job.jobId);
  assert.equal(again.attempts, 1);
  assert.notEqual(again.leaseToken, job.leaseToken);
  assert.equal(await prisma.jobRedrive.count(), 1);
});

test('a second successful PaymentIntent for one order requires investigation', async t => {
  const { prisma, queue } = await fixture(t);
  const firstEvent = facts();
  const order = await setupOrder(queue, firstEvent);
  const secondEvent = facts({ accountId: firstEvent.accountId, livemode: false });
  await queue.addPaymentIntentMapping({ orderId: order.id, accountId: firstEvent.accountId, livemode: false, paymentIntentId: secondEvent.paymentIntentId });
  await queue.ingestVerifiedEvent(firstEvent);
  const first = await queue.claimJob({ leaseSeconds: 30 });
  await queue.prepareFulfillment({ jobId: first.jobId, leaseToken: first.leaseToken, retrievePaymentIntent: retrieval(firstEvent) });
  await queue.ingestVerifiedEvent(secondEvent);
  const second = await queue.claimJob({ leaseSeconds: 30 });
  await rejectCode(queue.prepareFulfillment({ jobId: second.jobId, leaseToken: second.leaseToken, retrievePaymentIntent: retrieval(secondEvent) }), 'MULTIPLE_SUCCESSFUL_PAYMENTS');
  assert.equal(await prisma.fulfillmentOperation.count(), 1);
  assert.equal((await queue.getJob({ jobId: second.jobId })).job.status, 'PROCESSING');
});

test('dead-letter redrive refuses an ambiguous external operation', async t => {
  const { prisma, queue } = await fixture(t);
  const event = facts({ maxAttempts: 1 });
  await setupOrder(queue, event);
  await queue.ingestVerifiedEvent(event);
  const job = await queue.claimJob({ leaseSeconds: 1 });
  const op = await queue.prepareFulfillment({ jobId: job.jobId, leaseToken: job.leaseToken, retrievePaymentIntent: retrieval(event) });
  assert.equal((await queue.claimFulfillmentOperation({ jobId: job.jobId, leaseToken: job.leaseToken, operationId: op.operationId, businessSafetyChecked: true, leaseSeconds: 1 })).status, 'CLAIMED');
  await new Promise(resolve => setTimeout(resolve, 1150));
  assert.equal((await queue.claimJob({ leaseSeconds: 30 })).status, 'EMPTY');
  assert.equal((await queue.getJob({ jobId: job.jobId })).job.status, 'DEAD');
  assert.equal((await queue.getOperation({ operationId: op.operationId })).operation.status, 'NEEDS_RECONCILIATION');
  await rejectCode(queue.redriveDeadJob({ jobId: job.jobId, confirmed: true, actor: 'operator', evidenceReference: 'case-2' }), 'OPERATION_UNRESOLVED');
  assert.equal(await prisma.jobRedrive.count(), 0);
});
