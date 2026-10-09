-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "normalizedName" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseSequence" (
    "organizationId" UUID NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExpenseSequence_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "categoryId" UUID NOT NULL,
    "locationId" UUID,
    "expenseDate" DATE NOT NULL,
    "payeeName" VARCHAR(200),
    "description" VARCHAR(2000),
    "note" VARCHAR(2000),
    "amount" DECIMAL(19,4) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "postedAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "voidedByUserId" UUID,
    "voidReason" VARCHAR(1000),
    "creationIdempotencyKey" UUID NOT NULL,
    "creationRequestHash" CHAR(64) NOT NULL,
    "postingIdempotencyKey" UUID,
    "postingRequestHash" CHAR(64),
    "voidIdempotencyKey" UUID,
    "voidRequestHash" CHAR(64),

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseCategory_organizationId_createdAt_id_idx" ON "ExpenseCategory"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ExpenseCategory_organizationId_isActive_createdAt_id_idx" ON "ExpenseCategory"("organizationId", "isActive", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_id_organizationId_key" ON "ExpenseCategory"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_organizationId_normalizedName_key" ON "ExpenseCategory"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "Expense_organizationId_expenseDate_createdAt_id_idx" ON "Expense"("organizationId", "expenseDate" DESC, "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Expense_organizationId_status_expenseDate_createdAt_id_idx" ON "Expense"("organizationId", "status", "expenseDate" DESC, "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Expense_organizationId_categoryId_expenseDate_idx" ON "Expense"("organizationId", "categoryId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_organizationId_locationId_expenseDate_idx" ON "Expense"("organizationId", "locationId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_organizationId_paymentMethod_expenseDate_idx" ON "Expense"("organizationId", "paymentMethod", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_id_organizationId_key" ON "Expense"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_sequenceNumber_key" ON "Expense"("organizationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_creationIdempotencyKey_key" ON "Expense"("organizationId", "creationIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_postingIdempotencyKey_key" ON "Expense"("organizationId", "postingIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_voidIdempotencyKey_key" ON "Expense"("organizationId", "voidIdempotencyKey");

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseSequence" ADD CONSTRAINT "ExpenseSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_organizationId_fkey" FOREIGN KEY ("categoryId", "organizationId") REFERENCES "ExpenseCategory"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_locationId_organizationId_fkey" FOREIGN KEY ("locationId", "organizationId") REFERENCES "Location"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_createdByUserId_fkey" FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_voidedByUserId_fkey" FOREIGN KEY ("organizationId", "voidedByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Operational finance integrity and permission backfill.
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT expense_category_name_valid CHECK (
  length(btrim(name)) > 0 AND length(btrim("normalizedName")) > 0
  AND "normalizedName" = btrim("normalizedName")
);
ALTER TABLE "ExpenseSequence" ADD CONSTRAINT expense_sequence_nonnegative CHECK ("lastNumber" >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT expense_amount_and_state CHECK (
  "sequenceNumber" > 0 AND amount > 0 AND amount <> 'NaN'::numeric
  AND (status IN ('POSTED','VOIDED')) = ("postedAt" IS NOT NULL)
  AND (status = 'VOIDED') = ("voidedAt" IS NOT NULL)
  AND (status = 'VOIDED') = ("voidedByUserId" IS NOT NULL)
  AND (status = 'VOIDED') = ("voidReason" IS NOT NULL)
  AND ("voidReason" IS NULL OR length(btrim("voidReason")) > 0)
  AND (status IN ('POSTED','VOIDED')) = ("postingIdempotencyKey" IS NOT NULL)
  AND ("postingIdempotencyKey" IS NULL) = ("postingRequestHash" IS NULL)
  AND (status = 'VOIDED') = ("voidIdempotencyKey" IS NOT NULL)
  AND ("voidIdempotencyKey" IS NULL) = ("voidRequestHash" IS NULL)
);

CREATE FUNCTION protect_expense_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Expense history is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.id <> OLD.id OR NEW."organizationId" <> OLD."organizationId"
    OR NEW."sequenceNumber" <> OLD."sequenceNumber"
    OR NEW."currencyCode" <> OLD."currencyCode"
    OR NEW."createdByUserId" <> OLD."createdByUserId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR NEW."creationIdempotencyKey" <> OLD."creationIdempotencyKey"
    OR NEW."creationRequestHash" <> OLD."creationRequestHash" THEN
    RAISE EXCEPTION 'Expense identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT','POSTED')
      OR (NEW.status = 'POSTED' AND (
        NEW."categoryId" <> OLD."categoryId"
        OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
        OR NEW."expenseDate" <> OLD."expenseDate"
        OR NEW.amount <> OLD.amount
        OR NEW."paymentMethod" <> OLD."paymentMethod"
        OR NEW."payeeName" IS DISTINCT FROM OLD."payeeName"
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.note IS DISTINCT FROM OLD.note
      )) THEN
      RAISE EXCEPTION 'Invalid expense posting' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'POSTED' THEN
    IF NEW.status NOT IN ('POSTED','VOIDED')
      OR NEW."categoryId" <> OLD."categoryId"
      OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
      OR NEW."expenseDate" <> OLD."expenseDate"
      OR NEW.amount <> OLD.amount
      OR NEW."paymentMethod" <> OLD."paymentMethod"
      OR NEW."payeeName" IS DISTINCT FROM OLD."payeeName"
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.note IS DISTINCT FROM OLD.note
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."postingIdempotencyKey" IS DISTINCT FROM OLD."postingIdempotencyKey"
      OR NEW."postingRequestHash" IS DISTINCT FROM OLD."postingRequestHash" THEN
      RAISE EXCEPTION 'Posted expense is immutable' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Voided expense is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER expense_history_guard BEFORE UPDATE OR DELETE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION protect_expense_history();
CREATE FUNCTION reject_expense_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Expense history must be archived or voided' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER expense_no_truncate BEFORE TRUNCATE ON "Expense"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_expense_history_mutation();
CREATE TRIGGER expense_category_no_delete BEFORE DELETE ON "ExpenseCategory"
  FOR EACH ROW EXECUTE FUNCTION reject_expense_history_mutation();
CREATE TRIGGER expense_category_no_truncate BEFORE TRUNCATE ON "ExpenseCategory"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_expense_history_mutation();

INSERT INTO "RolePermission" ("organizationId","roleId","permissionCode")
SELECT r."organizationId",r.id,p.code FROM "Role" r
CROSS JOIN (VALUES ('expenses.view'),('expenses.manage'),('finance.view')) p(code)
WHERE r."isSystem" AND r.key IN ('OWNER','ADMIN')
ON CONFLICT ("roleId","permissionCode") DO NOTHING;

