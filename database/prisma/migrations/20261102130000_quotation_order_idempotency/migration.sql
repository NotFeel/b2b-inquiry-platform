-- Make draft saves and direct order creation safe to retry after a client timeout.
ALTER TABLE "quotations"
  ADD COLUMN "idempotencyKey" VARCHAR(120),
  ADD COLUMN "idempotencyPayloadHash" VARCHAR(64);

ALTER TABLE "orders"
  ADD COLUMN "idempotencyKey" VARCHAR(120),
  ADD COLUMN "idempotencyPayloadHash" VARCHAR(64);

CREATE UNIQUE INDEX "quotations_createdById_idempotencyKey_key"
  ON "quotations"("createdById", "idempotencyKey");

CREATE UNIQUE INDEX "orders_createdById_idempotencyKey_key"
  ON "orders"("createdById", "idempotencyKey");
