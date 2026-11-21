-- Apply the initial schema and all safety invariants atomically.
BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "StripeOrder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntentMapping" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentIntentMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "eventId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "StripeJob" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 10,
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(6),
    "operationId" TEXT,
    "verifiedLeaseToken" TEXT,
    "verifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRedrive" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "priorAttempts" INTEGER NOT NULL,
    "priorMaxAttempts" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRedrive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentOperation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "sourceMappingId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "claimedByJobId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(6),
    "completionTokenHash" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentReconciliation" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeOrder_accountId_livemode_externalOrderId_key" ON "StripeOrder"("accountId", "livemode", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeOrder_id_accountId_livemode_key" ON "StripeOrder"("id", "accountId", "livemode");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntentMapping_paymentIntentId_key" ON "PaymentIntentMapping"("paymentIntentId");

-- CreateIndex
CREATE INDEX "PaymentIntentMapping_orderId_idx" ON "PaymentIntentMapping"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntentMapping_id_orderId_accountId_livemode_key" ON "PaymentIntentMapping"("id", "orderId", "accountId", "livemode");

-- CreateIndex
CREATE UNIQUE INDEX "StripeJob_eventId_key" ON "StripeJob"("eventId");

-- CreateIndex
CREATE INDEX "StripeJob_status_availableAt_createdAt_idx" ON "StripeJob"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "StripeJob_status_leaseExpiresAt_idx" ON "StripeJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "JobRedrive_jobId_createdAt_idx" ON "JobRedrive"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentOperation_orderId_key" ON "FulfillmentOperation"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentOperation_idempotencyKey_key" ON "FulfillmentOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FulfillmentOperation_status_leaseExpiresAt_idx" ON "FulfillmentOperation"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "FulfillmentOperation_claimedByJobId_idx" ON "FulfillmentOperation"("claimedByJobId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentOperation_orderId_accountId_livemode_key" ON "FulfillmentOperation"("orderId", "accountId", "livemode");

-- CreateIndex
CREATE INDEX "FulfillmentReconciliation_operationId_createdAt_idx" ON "FulfillmentReconciliation"("operationId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentIntentMapping" ADD CONSTRAINT "PaymentIntentMapping_orderId_accountId_livemode_fkey" FOREIGN KEY ("orderId", "accountId", "livemode") REFERENCES "StripeOrder"("id", "accountId", "livemode") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StripeJob" ADD CONSTRAINT "StripeJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StripeEvent"("eventId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StripeJob" ADD CONSTRAINT "StripeJob_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "FulfillmentOperation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JobRedrive" ADD CONSTRAINT "JobRedrive_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "StripeJob"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FulfillmentOperation" ADD CONSTRAINT "FulfillmentOperation_orderId_accountId_livemode_fkey" FOREIGN KEY ("orderId", "accountId", "livemode") REFERENCES "StripeOrder"("id", "accountId", "livemode") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FulfillmentOperation" ADD CONSTRAINT "FulfillmentOperation_sourceMappingId_orderId_accountId_liv_fkey" FOREIGN KEY ("sourceMappingId", "orderId", "accountId", "livemode") REFERENCES "PaymentIntentMapping"("id", "orderId", "accountId", "livemode") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FulfillmentOperation" ADD CONSTRAINT "FulfillmentOperation_claimedByJobId_fkey" FOREIGN KEY ("claimedByJobId") REFERENCES "StripeJob"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FulfillmentReconciliation" ADD CONSTRAINT "FulfillmentReconciliation_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "FulfillmentOperation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- PostgreSQL-only constraints supplement Prisma's schema. IDs are opaque, canonical tokens.
ALTER TABLE "StripeOrder"
  ADD CONSTRAINT "order_account_check" CHECK ("accountId" ~ '^acct_[A-Za-z0-9]+$' AND length("accountId") <= 255),
  ADD CONSTRAINT "order_external_id_check" CHECK (length("externalOrderId") BETWEEN 1 AND 200 AND "externalOrderId" ~ '[^[:space:]]' AND "externalOrderId" !~ '[[:cntrl:]]'),
  ADD CONSTRAINT "order_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "order_currency_check" CHECK ("currency" ~ '^[a-z]{3}$');
ALTER TABLE "PaymentIntentMapping"
  ADD CONSTRAINT "mapping_account_check" CHECK ("accountId" ~ '^acct_[A-Za-z0-9]+$' AND length("accountId") <= 255),
  ADD CONSTRAINT "mapping_pi_check" CHECK ("paymentIntentId" ~ '^pi_[A-Za-z0-9]+$' AND length("paymentIntentId") <= 255);
ALTER TABLE "StripeEvent"
  ADD CONSTRAINT "event_id_check" CHECK ("eventId" ~ '^evt_[A-Za-z0-9]+$' AND length("eventId") <= 255),
  ADD CONSTRAINT "event_account_check" CHECK ("accountId" ~ '^acct_[A-Za-z0-9]+$' AND length("accountId") <= 255),
  ADD CONSTRAINT "event_pi_check" CHECK ("paymentIntentId" ~ '^pi_[A-Za-z0-9]+$' AND length("paymentIntentId") <= 255),
  ADD CONSTRAINT "event_type_check" CHECK ("eventType" = 'payment_intent.succeeded');
ALTER TABLE "StripeJob"
  ADD CONSTRAINT "job_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'DONE', 'DEAD')),
  ADD CONSTRAINT "job_attempts_check" CHECK ("maxAttempts" BETWEEN 1 AND 100 AND "attempts" BETWEEN 0 AND "maxAttempts"),
  ADD CONSTRAINT "job_lease_check" CHECK (("status" = 'PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("status" <> 'PROCESSING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)),
  ADD CONSTRAINT "job_verification_check" CHECK (("verifiedLeaseToken" IS NULL AND "verifiedAt" IS NULL) OR ("status" = 'PROCESSING' AND "verifiedLeaseToken" IS NOT NULL AND "verifiedLeaseToken" = "leaseToken" AND "verifiedAt" IS NOT NULL AND "operationId" IS NOT NULL));
ALTER TABLE "JobRedrive"
  ADD CONSTRAINT "redrive_attempts_check" CHECK ("priorMaxAttempts" BETWEEN 1 AND 100 AND "priorAttempts" BETWEEN 0 AND "priorMaxAttempts"),
  ADD CONSTRAINT "redrive_actor_check" CHECK ("actor" ~ '^[A-Za-z0-9_.:/-]{1,120}$' AND "actor" !~ '://' AND "actor" !~* '(^|[^A-Za-z0-9])([srp]k_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|(secret|password|bearer|token|api[_-]?key)([_.:/-]|$))'),
  ADD CONSTRAINT "redrive_evidence_check" CHECK ("evidenceReference" ~ '^[A-Za-z0-9_.:/-]{1,200}$' AND "evidenceReference" !~ '://' AND "evidenceReference" !~* '(^|[^A-Za-z0-9])([srp]k_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|(secret|password|bearer|token|api[_-]?key)([_.:/-]|$))');
ALTER TABLE "FulfillmentOperation"
  ADD CONSTRAINT "operation_status_check" CHECK ("status" IN ('READY', 'IN_FLIGHT', 'COMPLETED', 'NEEDS_RECONCILIATION')),
  ADD CONSTRAINT "operation_lease_check" CHECK (("status" = 'IN_FLIGHT' AND "claimedByJobId" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("status" <> 'IN_FLIGHT' AND "claimedByJobId" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)),
  ADD CONSTRAINT "operation_completion_hash_check" CHECK ("completionTokenHash" IS NULL OR ("status" = 'COMPLETED' AND "completionTokenHash" ~ '^[a-f0-9]{64}$'));
ALTER TABLE "FulfillmentReconciliation"
  ADD CONSTRAINT "reconciliation_decision_check" CHECK ("decision" IN ('CONFIRMED_COMPLETED', 'CONFIRMED_NOT_SENT')),
  ADD CONSTRAINT "reconciliation_actor_check" CHECK ("actor" ~ '^[A-Za-z0-9_.:/-]{1,120}$'),
  ADD CONSTRAINT "reconciliation_evidence_check" CHECK ("evidenceReference" ~ '^[A-Za-z0-9_.:/-]{1,200}$');

-- These partial indexes accelerate the exact claim/recovery predicates.
CREATE INDEX "StripeJob_pending_claim_idx" ON "StripeJob" ("availableAt", "createdAt", "id") WHERE "status" = 'PENDING';
CREATE INDEX "StripeJob_expired_claim_idx" ON "StripeJob" ("leaseExpiresAt", "id") WHERE "status" = 'PROCESSING';
CREATE INDEX "FulfillmentOperation_expired_idx" ON "FulfillmentOperation" ("leaseExpiresAt", "id") WHERE "status" = 'IN_FLIGHT';

CREATE FUNCTION prevent_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable queue record';
END;
$$;
CREATE TRIGGER "StripeOrder_immutable" BEFORE UPDATE OR DELETE ON "StripeOrder" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();
CREATE TRIGGER "Mapping_immutable" BEFORE UPDATE OR DELETE ON "PaymentIntentMapping" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();
CREATE TRIGGER "Event_immutable" BEFORE UPDATE OR DELETE ON "StripeEvent" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();
CREATE TRIGGER "Reconciliation_immutable" BEFORE UPDATE OR DELETE ON "FulfillmentReconciliation" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();
CREATE TRIGGER "JobRedrive_immutable" BEFORE UPDATE OR DELETE ON "JobRedrive" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();

CREATE FUNCTION protect_queue_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'queue record deletion prohibited'; END IF;
  IF TG_TABLE_NAME = 'StripeJob' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."eventId" IS DISTINCT FROM OLD."eventId" OR NEW."maxAttempts" IS DISTINCT FROM OLD."maxAttempts" THEN RAISE EXCEPTION 'immutable queue job identity'; END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."accountId" IS DISTINCT FROM OLD."accountId" OR NEW."livemode" IS DISTINCT FROM OLD."livemode" OR NEW."sourceMappingId" IS DISTINCT FROM OLD."sourceMappingId" OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" OR OLD."status" = 'COMPLETED' THEN RAISE EXCEPTION 'immutable fulfillment operation identity'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Job_identity" BEFORE UPDATE OR DELETE ON "StripeJob" FOR EACH ROW EXECUTE FUNCTION protect_queue_identity();
CREATE TRIGGER "Operation_identity" BEFORE UPDATE OR DELETE ON "FulfillmentOperation" FOR EACH ROW EXECUTE FUNCTION protect_queue_identity();

-- An event and exactly one job must commit together, even outside this library.
CREATE FUNCTION require_event_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "StripeJob" WHERE "eventId" = NEW."eventId") THEN RAISE EXCEPTION 'event must have a job'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "Event_requires_job" AFTER INSERT ON "StripeEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_event_job();

-- A job can reference only an operation belonging to its event's actual mapped order.
CREATE FUNCTION validate_job_operation_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."operationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "StripeEvent" e
    JOIN "PaymentIntentMapping" m ON m."paymentIntentId" = e."paymentIntentId" AND m."accountId" = e."accountId" AND m."livemode" = e."livemode"
    JOIN "FulfillmentOperation" o ON o."id" = NEW."operationId" AND o."orderId" = m."orderId" AND o."accountId" = e."accountId" AND o."livemode" = e."livemode"
    WHERE e."eventId" = NEW."eventId"
  ) THEN RAISE EXCEPTION 'job and operation scope or order mismatch'; END IF;
  IF NEW."status" = 'DONE' AND NOT EXISTS (SELECT 1 FROM "FulfillmentOperation" WHERE "id" = NEW."operationId" AND "status" = 'COMPLETED') THEN
    RAISE EXCEPTION 'job cannot be completed before operation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Job_operation_scope" BEFORE INSERT OR UPDATE OF "operationId", "eventId", "status" ON "StripeJob" FOR EACH ROW EXECUTE FUNCTION validate_job_operation_link();

CREATE FUNCTION validate_operation_claim_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."claimedByJobId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "StripeJob" j WHERE j."id" = NEW."claimedByJobId" AND j."operationId" = NEW."id" AND j."status" = 'PROCESSING'
  ) THEN RAISE EXCEPTION 'operation claim is not linked to an active job'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Operation_claim_scope" BEFORE INSERT OR UPDATE OF "claimedByJobId" ON "FulfillmentOperation" FOR EACH ROW EXECUTE FUNCTION validate_operation_claim_link();

COMMIT;
