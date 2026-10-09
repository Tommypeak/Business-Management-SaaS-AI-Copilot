-- CreateEnum
CREATE TYPE "SupplierBillStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateTable
CREATE TABLE "SupplierBillSequence" (
    "organizationId" UUID NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierBillSequence_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "SupplierBill" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "supplierId" UUID NOT NULL,
    "purchaseOrderId" UUID,
    "status" "SupplierBillStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierInvoiceNumber" VARCHAR(120),
    "normalizedInvoiceNumber" VARCHAR(120),
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "currencyCode" CHAR(3) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "description" VARCHAR(2000),
    "note" VARCHAR(2000),
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

    CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierBillId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(200),
    "note" VARCHAR(2000),
    "paymentDate" DATE NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierBill_organizationId_createdAt_id_idx" ON "SupplierBill"("organizationId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "SupplierBill_organizationId_status_createdAt_id_idx" ON "SupplierBill"("organizationId", "status", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "SupplierBill_organizationId_supplierId_createdAt_idx" ON "SupplierBill"("organizationId", "supplierId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SupplierBill_organizationId_purchaseOrderId_idx" ON "SupplierBill"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "SupplierBill_organizationId_dueDate_idx" ON "SupplierBill"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "SupplierBill_organizationId_issueDate_idx" ON "SupplierBill"("organizationId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_id_organizationId_key" ON "SupplierBill"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_organizationId_sequenceNumber_key" ON "SupplierBill"("organizationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_organizationId_creationIdempotencyKey_key" ON "SupplierBill"("organizationId", "creationIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_organizationId_postingIdempotencyKey_key" ON "SupplierBill"("organizationId", "postingIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_organizationId_voidIdempotencyKey_key" ON "SupplierBill"("organizationId", "voidIdempotencyKey");

-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_supplierBillId_createdAt_id_idx" ON "SupplierPayment"("organizationId", "supplierBillId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_paymentDate_idx" ON "SupplierPayment"("organizationId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_organizationId_idempotencyKey_key" ON "SupplierPayment"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_organizationId_supplierId_key" ON "PurchaseOrder"("id", "organizationId", "supplierId");

-- AddForeignKey
ALTER TABLE "SupplierBillSequence" ADD CONSTRAINT "SupplierBillSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_purchaseOrderId_organizationId_supplierId_fkey" FOREIGN KEY ("purchaseOrderId", "organizationId", "supplierId") REFERENCES "PurchaseOrder"("id", "organizationId", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_organizationId_createdByUserId_fkey" FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_organizationId_voidedByUserId_fkey" FOREIGN KEY ("organizationId", "voidedByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierBillId_organizationId_fkey" FOREIGN KEY ("supplierBillId", "organizationId") REFERENCES "SupplierBill"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_organizationId_createdByUserId_fkey" FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only posted, non-voided invoices reserve the supplier's external reference.
CREATE UNIQUE INDEX supplier_bill_active_invoice_unique
  ON "SupplierBill" ("organizationId", "supplierId", "normalizedInvoiceNumber")
  WHERE status = 'POSTED' AND "normalizedInvoiceNumber" IS NOT NULL;
ALTER TABLE "SupplierBillSequence" ADD CONSTRAINT supplier_bill_sequence_nonnegative CHECK ("lastNumber" >= 0);
ALTER TABLE "SupplierBill" ADD CONSTRAINT supplier_bill_amount_dates_state CHECK (
  "sequenceNumber" > 0 AND amount > 0 AND amount <> 'NaN'::numeric
  AND ("dueDate" IS NULL OR "dueDate" >= "issueDate")
  AND ("supplierInvoiceNumber" IS NULL) = ("normalizedInvoiceNumber" IS NULL)
  AND ("normalizedInvoiceNumber" IS NULL OR length(btrim("normalizedInvoiceNumber")) > 0)
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
ALTER TABLE "SupplierPayment" ADD CONSTRAINT supplier_payment_positive CHECK (amount > 0 AND amount <> 'NaN'::numeric);

CREATE FUNCTION protect_supplier_bill_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE has_payment boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Supplier Bill history is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.id <> OLD.id OR NEW."organizationId" <> OLD."organizationId"
    OR NEW."sequenceNumber" <> OLD."sequenceNumber"
    OR NEW."currencyCode" <> OLD."currencyCode"
    OR NEW."createdByUserId" <> OLD."createdByUserId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR NEW."creationIdempotencyKey" <> OLD."creationIdempotencyKey"
    OR NEW."creationRequestHash" <> OLD."creationRequestHash" THEN
    RAISE EXCEPTION 'Supplier Bill identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT','POSTED')
      OR (NEW.status = 'POSTED' AND (
        NEW."supplierId" <> OLD."supplierId"
        OR NEW."purchaseOrderId" IS DISTINCT FROM OLD."purchaseOrderId"
        OR NEW."supplierInvoiceNumber" IS DISTINCT FROM OLD."supplierInvoiceNumber"
        OR NEW."normalizedInvoiceNumber" IS DISTINCT FROM OLD."normalizedInvoiceNumber"
        OR NEW."issueDate" <> OLD."issueDate"
        OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
        OR NEW.amount <> OLD.amount
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.note IS DISTINCT FROM OLD.note
      )) THEN
      RAISE EXCEPTION 'Invalid Supplier Bill posting' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'POSTED' THEN
    IF NEW.status NOT IN ('POSTED','VOIDED')
      OR NEW."supplierId" <> OLD."supplierId"
      OR NEW."purchaseOrderId" IS DISTINCT FROM OLD."purchaseOrderId"
      OR NEW."supplierInvoiceNumber" IS DISTINCT FROM OLD."supplierInvoiceNumber"
      OR NEW."normalizedInvoiceNumber" IS DISTINCT FROM OLD."normalizedInvoiceNumber"
      OR NEW."issueDate" <> OLD."issueDate"
      OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
      OR NEW.amount <> OLD.amount
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.note IS DISTINCT FROM OLD.note
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."postingIdempotencyKey" IS DISTINCT FROM OLD."postingIdempotencyKey"
      OR NEW."postingRequestHash" IS DISTINCT FROM OLD."postingRequestHash" THEN
      RAISE EXCEPTION 'Posted Supplier Bill is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'VOIDED' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."SupplierPayment" p WHERE p."organizationId" = $1 AND p."supplierBillId" = $2)', TG_TABLE_SCHEMA)
        INTO has_payment USING OLD."organizationId", OLD.id;
      IF has_payment THEN
        RAISE EXCEPTION 'Supplier Bill has payments' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Voided Supplier Bill is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER supplier_bill_history_guard BEFORE UPDATE OR DELETE ON "SupplierBill"
  FOR EACH ROW EXECUTE FUNCTION protect_supplier_bill_history();

CREATE FUNCTION protect_supplier_payment_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bill_amount numeric(19,4); bill_status text; already_paid numeric(19,4);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Supplier Payment is immutable' USING ERRCODE = '23514';
  END IF;
  EXECUTE format('SELECT amount, status::text FROM %I."SupplierBill" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE', TG_TABLE_SCHEMA)
    INTO bill_amount, bill_status USING NEW."supplierBillId", NEW."organizationId";
  IF bill_status IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'Supplier Bill is not payable' USING ERRCODE = '23514';
  END IF;
  EXECUTE format('SELECT COALESCE(SUM(amount), 0) FROM %I."SupplierPayment" WHERE "organizationId" = $1 AND "supplierBillId" = $2', TG_TABLE_SCHEMA)
    INTO already_paid USING NEW."organizationId", NEW."supplierBillId";
  IF already_paid + NEW.amount > bill_amount THEN
    RAISE EXCEPTION 'Supplier Payment exceeds outstanding' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER supplier_payment_history_guard BEFORE INSERT OR UPDATE OR DELETE ON "SupplierPayment"
  FOR EACH ROW EXECUTE FUNCTION protect_supplier_payment_history();

CREATE FUNCTION reject_ap_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Accounts Payable history is immutable' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER supplier_bill_no_truncate BEFORE TRUNCATE ON "SupplierBill"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_ap_history_mutation();
CREATE TRIGGER supplier_payment_no_truncate BEFORE TRUNCATE ON "SupplierPayment"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_ap_history_mutation();

INSERT INTO "RolePermission" ("organizationId","roleId","permissionCode")
SELECT r."organizationId",r.id,p.code FROM "Role" r
CROSS JOIN (VALUES ('accountsPayable.view'),('accountsPayable.manage'),('accountsPayable.payments.manage')) p(code)
WHERE r."isSystem" AND r.key IN ('OWNER','ADMIN')
ON CONFLICT ("roleId","permissionCode") DO NOTHING;
