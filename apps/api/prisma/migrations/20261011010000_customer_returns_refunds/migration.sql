-- CreateEnum
CREATE TYPE "SalesReturnStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RestockDisposition" AS ENUM ('RESTOCK', 'NO_RESTOCK');

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'SALE_RETURN';

-- AlterTable
ALTER TABLE "InventoryTransaction" ADD COLUMN     "salesReturnId" UUID;

-- CreateTable
CREATE TABLE "SalesReturnSequence" (
    "organizationId" UUID NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesReturnSequence_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "CustomerRefundSequence" (
    "organizationId" UUID NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerRefundSequence_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "SalesReturn" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "salesOrderId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "status" "SalesReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" VARCHAR(1000),
    "note" VARCHAR(2000),
    "currencyCode" CHAR(3) NOT NULL,
    "totalRefundableAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "postedByUserId" UUID,
    "cancelledByUserId" UUID,
    "cancelReason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "postedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "creationIdempotencyKey" UUID NOT NULL,
    "creationRequestHash" CHAR(64) NOT NULL,
    "postingIdempotencyKey" UUID,
    "postingRequestHash" CHAR(64),
    "cancellationIdempotencyKey" UUID,
    "cancellationRequestHash" CHAR(64),

    CONSTRAINT "SalesReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturnItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "salesOrderId" UUID NOT NULL,
    "salesReturnId" UUID NOT NULL,
    "salesOrderItemId" UUID NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "restockDisposition" "RestockDisposition" NOT NULL,
    "locationId" UUID,
    "refundAmount" DECIMAL(19,4) NOT NULL,
    "stockRestocked" BOOLEAN NOT NULL DEFAULT false,
    "snapshotItemName" VARCHAR(200) NOT NULL,
    "snapshotVariantName" VARCHAR(120),
    "snapshotSku" VARCHAR(80),
    "snapshotUnit" "UnitOfMeasure" NOT NULL,
    "snapshotItemType" "CatalogItemType",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRefund" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "salesOrderId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentDate" DATE NOT NULL,
    "reference" VARCHAR(200),
    "note" VARCHAR(2000),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,

    CONSTRAINT "CustomerRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundAllocation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "salesOrderId" UUID NOT NULL,
    "customerRefundId" UUID NOT NULL,
    "salesReturnId" UUID NOT NULL,
    "allocatedAmount" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesReturn_organizationId_salesOrderId_status_idx" ON "SalesReturn"("organizationId", "salesOrderId", "status");

-- CreateIndex
CREATE INDEX "SalesReturn_organizationId_status_createdAt_id_idx" ON "SalesReturn"("organizationId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SalesReturn_organizationId_createdAt_id_idx" ON "SalesReturn"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SalesReturn_organizationId_postedAt_idx" ON "SalesReturn"("organizationId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_id_organizationId_key" ON "SalesReturn"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_id_organizationId_salesOrderId_key" ON "SalesReturn"("id", "organizationId", "salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_organizationId_sequenceNumber_key" ON "SalesReturn"("organizationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_organizationId_creationIdempotencyKey_key" ON "SalesReturn"("organizationId", "creationIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_organizationId_postingIdempotencyKey_key" ON "SalesReturn"("organizationId", "postingIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_organizationId_cancellationIdempotencyKey_key" ON "SalesReturn"("organizationId", "cancellationIdempotencyKey");

-- CreateIndex
CREATE INDEX "SalesReturnItem_organizationId_salesOrderItemId_idx" ON "SalesReturnItem"("organizationId", "salesOrderItemId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_organizationId_salesReturnId_idx" ON "SalesReturnItem"("organizationId", "salesReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturnItem_salesReturnId_salesOrderItemId_key" ON "SalesReturnItem"("salesReturnId", "salesOrderItemId");

-- CreateIndex
CREATE INDEX "CustomerRefund_organizationId_salesOrderId_createdAt_id_idx" ON "CustomerRefund"("organizationId", "salesOrderId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CustomerRefund_organizationId_paymentDate_idx" ON "CustomerRefund"("organizationId", "paymentDate");

-- CreateIndex
CREATE INDEX "CustomerRefund_organizationId_createdAt_id_idx" ON "CustomerRefund"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRefund_id_organizationId_salesOrderId_key" ON "CustomerRefund"("id", "organizationId", "salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRefund_organizationId_sequenceNumber_key" ON "CustomerRefund"("organizationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRefund_organizationId_idempotencyKey_key" ON "CustomerRefund"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RefundAllocation_organizationId_salesReturnId_idx" ON "RefundAllocation"("organizationId", "salesReturnId");

-- CreateIndex
CREATE INDEX "RefundAllocation_organizationId_customerRefundId_idx" ON "RefundAllocation"("organizationId", "customerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundAllocation_customerRefundId_salesReturnId_key" ON "RefundAllocation"("customerRefundId", "salesReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_salesReturnId_key" ON "InventoryTransaction"("salesReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_salesReturnId_organizationId_key" ON "InventoryTransaction"("salesReturnId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderItem_id_organizationId_salesOrderId_key" ON "SalesOrderItem"("id", "organizationId", "salesOrderId");

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_salesReturnId_organizationId_fkey" FOREIGN KEY ("salesReturnId", "organizationId") REFERENCES "SalesReturn"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnSequence" ADD CONSTRAINT "SalesReturnSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRefundSequence" ADD CONSTRAINT "CustomerRefundSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_salesOrderId_organizationId_fkey" FOREIGN KEY ("salesOrderId", "organizationId") REFERENCES "SalesOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_organizationId_createdByUserId_fkey" FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_organizationId_postedByUserId_fkey" FOREIGN KEY ("organizationId", "postedByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_organizationId_cancelledByUserId_fkey" FOREIGN KEY ("organizationId", "cancelledByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_salesReturnId_organizationId_salesOrderId_fkey" FOREIGN KEY ("salesReturnId", "organizationId", "salesOrderId") REFERENCES "SalesReturn"("id", "organizationId", "salesOrderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_salesOrderItemId_organizationId_salesOrder_fkey" FOREIGN KEY ("salesOrderItemId", "organizationId", "salesOrderId") REFERENCES "SalesOrderItem"("id", "organizationId", "salesOrderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_locationId_organizationId_fkey" FOREIGN KEY ("locationId", "organizationId") REFERENCES "Location"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRefund" ADD CONSTRAINT "CustomerRefund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRefund" ADD CONSTRAINT "CustomerRefund_salesOrderId_organizationId_fkey" FOREIGN KEY ("salesOrderId", "organizationId") REFERENCES "SalesOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRefund" ADD CONSTRAINT "CustomerRefund_organizationId_createdByUserId_fkey" FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAllocation" ADD CONSTRAINT "RefundAllocation_customerRefundId_organizationId_salesOrde_fkey" FOREIGN KEY ("customerRefundId", "organizationId", "salesOrderId") REFERENCES "CustomerRefund"("id", "organizationId", "salesOrderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAllocation" ADD CONSTRAINT "RefundAllocation_salesReturnId_organizationId_salesOrderId_fkey" FOREIGN KEY ("salesReturnId", "organizationId", "salesOrderId") REFERENCES "SalesReturn"("id", "organizationId", "salesOrderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business invariants are enforced for application and direct SQL callers.
ALTER TABLE "SalesReturnSequence" ADD CONSTRAINT return_sequence_nonnegative CHECK ("lastNumber" >= 0);
ALTER TABLE "CustomerRefundSequence" ADD CONSTRAINT refund_sequence_nonnegative CHECK ("lastNumber" >= 0);
ALTER TABLE "SalesReturn" ADD CONSTRAINT return_metadata CHECK (
  "sequenceNumber" > 0 AND revision >= 0 AND "totalRefundableAmount" >= 0 AND "totalRefundableAmount" <> 'NaN'::numeric
  AND "creationRequestHash" ~ '^[a-f0-9]{64}$'
  AND ((status::text='POSTED') = ("postedAt" IS NOT NULL AND "postedByUserId" IS NOT NULL AND "postingIdempotencyKey" IS NOT NULL AND "postingRequestHash" ~ '^[a-f0-9]{64}$'))
  AND ((status::text='CANCELLED') = ("cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL AND "cancellationIdempotencyKey" IS NOT NULL AND "cancellationRequestHash" ~ '^[a-f0-9]{64}$'))
  AND (status::text='POSTED' OR ("postedAt" IS NULL AND "postedByUserId" IS NULL AND "postingIdempotencyKey" IS NULL AND "postingRequestHash" IS NULL))
  AND (status::text='CANCELLED' OR ("cancelledAt" IS NULL AND "cancelledByUserId" IS NULL AND "cancellationIdempotencyKey" IS NULL AND "cancellationRequestHash" IS NULL AND "cancelReason" IS NULL))
);
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT return_line_numeric CHECK (
  quantity > 0 AND quantity <> 'NaN'::numeric AND "refundAmount" >= 0 AND "refundAmount" <> 'NaN'::numeric
  AND ("restockDisposition"::text='RESTOCK' OR ("locationId" IS NULL AND NOT "stockRestocked"))
);
ALTER TABLE "CustomerRefund" ADD CONSTRAINT refund_positive CHECK (
  amount > 0 AND amount <> 'NaN'::numeric AND "sequenceNumber" > 0 AND "requestHash" ~ '^[a-f0-9]{64}$'
);
ALTER TABLE "RefundAllocation" ADD CONSTRAINT allocation_positive CHECK ("allocatedAmount" > 0 AND "allocatedAmount" <> 'NaN'::numeric);
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT inventory_return_source CHECK ((type::text='SALE_RETURN') = ("salesReturnId" IS NOT NULL));

CREATE FUNCTION protect_return_header() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale record; invalid boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Return history cannot be deleted' USING ERRCODE='23514'; END IF;
  EXECUTE format('SELECT * FROM %I."SalesOrder" WHERE id=$1 AND "organizationId"=$2 FOR UPDATE',TG_TABLE_SCHEMA)
    INTO sale USING NEW."salesOrderId",NEW."organizationId";
  IF sale.status::text IS DISTINCT FROM 'COMPLETED' OR NEW."currencyCode" IS DISTINCT FROM sale."currencyCode" THEN
    RAISE EXCEPTION 'Return requires completed sale in the same currency' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.status::text <> 'DRAFT' THEN RAISE EXCEPTION 'Return must start as draft' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status::text <> 'DRAFT' OR
      ROW(NEW.id,NEW."organizationId",NEW."salesOrderId",NEW."sequenceNumber",NEW."currencyCode",NEW."createdAt",NEW."createdByUserId",NEW."creationIdempotencyKey",NEW."creationRequestHash")
      IS DISTINCT FROM ROW(OLD.id,OLD."organizationId",OLD."salesOrderId",OLD."sequenceNumber",OLD."currencyCode",OLD."createdAt",OLD."createdByUserId",OLD."creationIdempotencyKey",OLD."creationRequestHash") THEN
      RAISE EXCEPTION 'Return history is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status::text='POSTED' THEN
      EXECUTE format('SELECT EXISTS (
        SELECT 1 FROM %1$I."SalesReturnItem" i JOIN %1$I."SalesOrderItem" s ON s.id=i."salesOrderItemId"
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(p.quantity),0) q, COALESCE(sum(p."refundAmount"),0) c
          FROM %1$I."SalesReturnItem" p JOIN %1$I."SalesReturn" r ON r.id=p."salesReturnId"
          WHERE p."salesOrderItemId"=s.id AND r.status::text=''POSTED''
        ) old ON true
        WHERE i."salesReturnId"=$1 AND (old.q+i.quantity>s.quantity OR
          i."refundAmount"<>round(s."lineTotal"*(old.q+i.quantity)/s.quantity,4)-old.c))',TG_TABLE_SCHEMA)
        INTO invalid USING NEW.id;
      IF invalid THEN RAISE EXCEPTION 'Return exceeds sold quantity or proportional credit' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER return_header_guard BEFORE INSERT OR UPDATE OR DELETE ON "SalesReturn" FOR EACH ROW EXECUTE FUNCTION protect_return_header();

CREATE FUNCTION protect_return_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent record; source record; target uuid; sale_id uuid; state text;
BEGIN
  IF TG_OP='DELETE' THEN target:=OLD."salesReturnId"; sale_id:=OLD."salesOrderId";
  ELSE target:=NEW."salesReturnId"; sale_id:=NEW."salesOrderId"; END IF;
  EXECUTE format('SELECT status::text FROM %I."SalesOrder" WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) INTO state USING sale_id;
  EXECUTE format('SELECT * FROM %I."SalesReturn" WHERE id=$1',TG_TABLE_SCHEMA) INTO parent USING target;
  IF parent.status::text IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Return lines are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."organizationId",NEW."salesOrderId",NEW."salesReturnId",NEW."salesOrderItemId")
    IS DISTINCT FROM ROW(OLD.id,OLD."organizationId",OLD."salesOrderId",OLD."salesReturnId",OLD."salesOrderItemId") THEN
    RAISE EXCEPTION 'Return line identity is immutable' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT * FROM %I."SalesOrderItem" WHERE id=$1 AND "organizationId"=$2 AND "salesOrderId"=$3',TG_TABLE_SCHEMA)
    INTO source USING NEW."salesOrderItemId",NEW."organizationId",NEW."salesOrderId";
  IF source.id IS NULL OR NEW.quantity>source.quantity OR
    ROW(NEW."snapshotItemName",NEW."snapshotVariantName",NEW."snapshotSku",NEW."snapshotUnit",NEW."snapshotItemType")
    IS DISTINCT FROM ROW(source."snapshotItemName",source."snapshotVariantName",source."snapshotSku",source."snapshotUnit",source."snapshotItemType")
    OR (NEW."restockDisposition"::text='RESTOCK' AND source."snapshotItemType"::text IS DISTINCT FROM 'PRODUCT')
    OR (NEW."restockDisposition"::text='RESTOCK' AND source."stockDeducted" AND NEW."locationId" IS NULL) THEN
    RAISE EXCEPTION 'Invalid return source, snapshot or restock disposition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER return_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "SalesReturnItem" FOR EACH ROW EXECUTE FUNCTION protect_return_line();

CREATE FUNCTION validate_return_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; tid uuid; doc record; stats record; invalid boolean; movements integer;
BEGIN
  IF TG_TABLE_NAME='SalesReturn' THEN rid:=NEW.id;
  ELSIF TG_TABLE_NAME='SalesReturnItem' THEN
    IF TG_OP='DELETE' THEN rid:=OLD."salesReturnId"; ELSE rid:=NEW."salesReturnId"; END IF;
  ELSE
    IF TG_TABLE_NAME='InventoryTransaction' THEN rid:=NEW."salesReturnId";
    ELSE EXECUTE format('SELECT "salesReturnId" FROM %I."InventoryTransaction" WHERE id=$1',TG_TABLE_SCHEMA) INTO rid USING NEW."transactionId"; END IF;
  END IF;
  IF rid IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT * FROM %I."SalesReturn" WHERE id=$1',TG_TABLE_SCHEMA) INTO doc USING rid;
  EXECUTE format('SELECT id FROM %I."SalesOrder" WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) USING doc."salesOrderId";
  EXECUTE format('SELECT count(*) n,COALESCE(sum("refundAmount"),0) credit,count(*) FILTER(WHERE "stockRestocked") tracked FROM %I."SalesReturnItem" WHERE "salesReturnId"=$1',TG_TABLE_SCHEMA) INTO stats USING rid;
  EXECUTE format('SELECT count(*),min(id::text)::uuid FROM %I."InventoryTransaction" WHERE "salesReturnId"=$1',TG_TABLE_SCHEMA) INTO movements,tid USING rid;
  IF stats.n=0 OR stats.n>100 OR stats.credit<>doc."totalRefundableAmount"
    OR (doc.status::text<>'POSTED' AND (movements>0 OR stats.tracked>0))
    OR (doc.status::text='POSTED' AND movements<>CASE WHEN stats.tracked>0 THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'Invalid return totals, lines or inventory command' USING ERRCODE='23514';
  END IF;
  IF doc.status::text='POSTED' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %1$I."SalesReturnItem" i JOIN %1$I."SalesOrderItem" s ON s.id=i."salesOrderItemId"
      LEFT JOIN %1$I."Location" l ON l.id=i."locationId" LEFT JOIN %1$I."CatalogVariant" v ON v.id=s."variantId"
      WHERE i."salesReturnId"=$1 AND (i."stockRestocked" IS DISTINCT FROM
        (s."stockDeducted" AND s."snapshotItemType"::text=''PRODUCT'' AND i."restockDisposition"::text=''RESTOCK'')
        OR (i."stockRestocked" AND (l.id IS NULL OR NOT l."isActive" OR v.unit<>s."snapshotUnit"))))',TG_TABLE_SCHEMA) INTO invalid USING rid;
    IF invalid THEN RAISE EXCEPTION 'Invalid historical restock facts' USING ERRCODE='23514'; END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %1$I."SalesOrderItem" s
      JOIN %1$I."SalesReturnItem" i ON i."salesOrderItemId"=s.id JOIN %1$I."SalesReturn" r ON r.id=i."salesReturnId"
      WHERE s."salesOrderId"=$1 AND r.status::text=''POSTED''
      GROUP BY s.id HAVING sum(i.quantity)>s.quantity OR sum(i."refundAmount")<>round(s."lineTotal"*sum(i.quantity)/s.quantity,4))',TG_TABLE_SCHEMA) INTO invalid USING doc."salesOrderId";
    IF invalid THEN RAISE EXCEPTION 'Invalid cumulative return quantity or credit' USING ERRCODE='23514'; END IF;
    EXECUTE format('SELECT EXISTS (
      (SELECT "locationId",s."variantId",sum(i.quantity) FROM %1$I."SalesReturnItem" i JOIN %1$I."SalesOrderItem" s ON s.id=i."salesOrderItemId"
       WHERE i."salesReturnId"=$1 AND i."stockRestocked" GROUP BY "locationId",s."variantId"
       EXCEPT ALL SELECT "locationId","variantId","quantityDelta" FROM %1$I."InventoryLedgerEntry" WHERE "transactionId"=$2)
      UNION ALL
      (SELECT "locationId","variantId","quantityDelta" FROM %1$I."InventoryLedgerEntry" WHERE "transactionId"=$2
       EXCEPT ALL SELECT "locationId",s."variantId",sum(i.quantity) FROM %1$I."SalesReturnItem" i JOIN %1$I."SalesOrderItem" s ON s.id=i."salesOrderItemId"
       WHERE i."salesReturnId"=$1 AND i."stockRestocked" GROUP BY "locationId",s."variantId")
    )',TG_TABLE_SCHEMA) INTO invalid USING rid,tid;
    IF invalid THEN RAISE EXCEPTION 'Return inventory entries do not match restocked lines' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER return_document_validate AFTER INSERT OR UPDATE ON "SalesReturn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_return_document();
CREATE CONSTRAINT TRIGGER return_lines_validate AFTER INSERT OR UPDATE OR DELETE ON "SalesReturnItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_return_document();
CREATE CONSTRAINT TRIGGER return_transaction_validate AFTER INSERT ON "InventoryTransaction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_return_document();
CREATE CONSTRAINT TRIGGER return_entry_validate AFTER INSERT ON "InventoryLedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_return_document();

CREATE FUNCTION protect_customer_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale record; paid numeric; refunded numeric;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Customer refunds are immutable' USING ERRCODE='23514'; END IF;
  EXECUTE format('SELECT * FROM %I."SalesOrder" WHERE id=$1 AND "organizationId"=$2 FOR UPDATE',TG_TABLE_SCHEMA) INTO sale USING NEW."salesOrderId",NEW."organizationId";
  EXECUTE format('SELECT COALESCE(sum(amount),0) FROM %I."SalesPayment" WHERE "salesOrderId"=$1',TG_TABLE_SCHEMA) INTO paid USING NEW."salesOrderId";
  EXECUTE format('SELECT COALESCE(sum(amount),0) FROM %I."CustomerRefund" WHERE "salesOrderId"=$1',TG_TABLE_SCHEMA) INTO refunded USING NEW."salesOrderId";
  IF sale.status::text IS DISTINCT FROM 'COMPLETED' OR NEW."currencyCode" IS DISTINCT FROM sale."currencyCode" OR refunded+NEW.amount>paid THEN
    RAISE EXCEPTION 'Refund exceeds original payments or has invalid source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER customer_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON "CustomerRefund" FOR EACH ROW EXECUTE FUNCTION protect_customer_refund();
CREATE FUNCTION lock_refund_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SELECT id FROM %I."SalesOrder" WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) USING NEW."salesOrderId";
  RETURN NEW;
END; $$;
CREATE TRIGGER allocation_lock BEFORE INSERT ON "RefundAllocation" FOR EACH ROW EXECUTE FUNCTION lock_refund_allocation();
CREATE FUNCTION validate_customer_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fid uuid; refund record; allocated numeric; n integer; invalid boolean; paid numeric; refunded numeric;
BEGIN
  IF TG_TABLE_NAME='CustomerRefund' THEN fid:=NEW.id; ELSE fid:=NEW."customerRefundId"; END IF;
  EXECUTE format('SELECT * FROM %I."CustomerRefund" WHERE id=$1',TG_TABLE_SCHEMA) INTO refund USING fid;
  EXECUTE format('SELECT id FROM %I."SalesOrder" WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) USING refund."salesOrderId";
  EXECUTE format('SELECT count(*),COALESCE(sum("allocatedAmount"),0) FROM %I."RefundAllocation" WHERE "customerRefundId"=$1',TG_TABLE_SCHEMA) INTO n,allocated USING fid;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %1$I."RefundAllocation" a JOIN %1$I."SalesReturn" r ON r.id=a."salesReturnId"
    WHERE r."salesOrderId"=$1 GROUP BY r.id HAVING r.status::text<>''POSTED'' OR sum(a."allocatedAmount")>r."totalRefundableAmount")',TG_TABLE_SCHEMA) INTO invalid USING refund."salesOrderId";
  EXECUTE format('SELECT COALESCE(sum(amount),0) FROM %I."SalesPayment" WHERE "salesOrderId"=$1',TG_TABLE_SCHEMA) INTO paid USING refund."salesOrderId";
  EXECUTE format('SELECT COALESCE(sum(amount),0) FROM %I."CustomerRefund" WHERE "salesOrderId"=$1',TG_TABLE_SCHEMA) INTO refunded USING refund."salesOrderId";
  IF n<1 OR n>100 OR allocated<>refund.amount OR invalid OR refunded>paid THEN
    RAISE EXCEPTION 'Invalid refund allocation or cash cap' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER customer_refund_validate AFTER INSERT ON "CustomerRefund" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_customer_refund();
CREATE CONSTRAINT TRIGGER refund_allocation_validate AFTER INSERT ON "RefundAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_customer_refund();
CREATE FUNCTION reject_returns_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Returns and refunds history is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER allocation_immutable BEFORE UPDATE OR DELETE ON "RefundAllocation" FOR EACH ROW EXECUTE FUNCTION reject_returns_mutation();
CREATE TRIGGER return_no_truncate BEFORE TRUNCATE ON "SalesReturn" FOR EACH STATEMENT EXECUTE FUNCTION reject_returns_mutation();
CREATE TRIGGER return_line_no_truncate BEFORE TRUNCATE ON "SalesReturnItem" FOR EACH STATEMENT EXECUTE FUNCTION reject_returns_mutation();
CREATE TRIGGER customer_refund_no_truncate BEFORE TRUNCATE ON "CustomerRefund" FOR EACH STATEMENT EXECUTE FUNCTION reject_returns_mutation();
CREATE TRIGGER allocation_no_truncate BEFORE TRUNCATE ON "RefundAllocation" FOR EACH STATEMENT EXECUTE FUNCTION reject_returns_mutation();

CREATE OR REPLACE FUNCTION validate_sales_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text; total numeric; paid numeric; credits numeric; refunds numeric;
BEGIN
  EXECUTE format('SELECT status::text,total FROM %I."SalesOrder" WHERE id=$1 AND "organizationId"=$2 FOR UPDATE',TG_TABLE_SCHEMA) INTO state,total USING NEW."salesOrderId",NEW."organizationId";
  EXECUTE format('SELECT COALESCE(sum(amount),0) FROM %I."SalesPayment" WHERE "salesOrderId"=$1',TG_TABLE_SCHEMA) INTO paid USING NEW."salesOrderId";
  EXECUTE format('SELECT COALESCE(sum("totalRefundableAmount"),0) FROM %I."SalesReturn" WHERE "salesOrderId"=$1 AND status::text=''POSTED''',TG_TABLE_SCHEMA) INTO credits USING NEW."salesOrderId";
  EXECUTE format('SELECT COALESCE(sum(amount),0) FROM %I."CustomerRefund" WHERE "salesOrderId"=$1',TG_TABLE_SCHEMA) INTO refunds USING NEW."salesOrderId";
  IF state IS DISTINCT FROM 'COMPLETED' OR paid+NEW.amount-refunds>total-credits THEN
    RAISE EXCEPTION 'Invalid payment state or net outstanding amount' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
INSERT INTO "RolePermission" ("organizationId","roleId","permissionCode")
SELECT r."organizationId",r.id,p.code FROM "Role" r
CROSS JOIN (VALUES ('returns.view'),('returns.manage'),('refunds.manage')) p(code)
WHERE r."isSystem" AND (r.key IN ('OWNER','ADMIN') OR (r.key='MEMBER' AND p.code='returns.view'))
ON CONFLICT ("roleId","permissionCode") DO NOTHING;
