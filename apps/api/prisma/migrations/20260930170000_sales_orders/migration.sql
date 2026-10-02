-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'OTHER');

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'SALE';

-- AlterTable
ALTER TABLE "InventoryTransaction" ADD COLUMN     "salesOrderId" UUID;

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "CustomerType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(50),
    "notes" VARCHAR(2000),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesSequence" (
    "organizationId" UUID NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesSequence_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "locationId" UUID,
    "customerId" UUID,
    "currencyCode" CHAR(3) NOT NULL,
    "note" VARCHAR(2000),
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "creationIdempotencyKey" UUID NOT NULL,
    "creationRequestHash" CHAR(64) NOT NULL,
    "completionIdempotencyKey" UUID,
    "completionRequestHash" CHAR(64),

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "stockDeducted" BOOLEAN NOT NULL DEFAULT false,
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "salesOrderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "discountAmount" DECIMAL(19,4) NOT NULL,
    "lineTotal" DECIMAL(19,4) NOT NULL,
    "snapshotItemName" VARCHAR(200) NOT NULL,
    "snapshotVariantName" VARCHAR(120),
    "snapshotSku" VARCHAR(80),
    "snapshotUnit" "UnitOfMeasure" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "salesOrderId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(200),
    "note" VARCHAR(2000),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,

    CONSTRAINT "SalesPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_organizationId_createdAt_id_idx" ON "Customer"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Customer_organizationId_isActive_createdAt_id_idx" ON "Customer"("organizationId", "isActive", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_organizationId_key" ON "Customer"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SalesOrder_organizationId_createdAt_id_idx" ON "SalesOrder"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SalesOrder_organizationId_status_createdAt_id_idx" ON "SalesOrder"("organizationId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SalesOrder_organizationId_customerId_createdAt_id_idx" ON "SalesOrder"("organizationId", "customerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SalesOrder_organizationId_locationId_createdAt_id_idx" ON "SalesOrder"("organizationId", "locationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_id_organizationId_key" ON "SalesOrder"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_organizationId_sequenceNumber_key" ON "SalesOrder"("organizationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_organizationId_creationIdempotencyKey_key" ON "SalesOrder"("organizationId", "creationIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_organizationId_completionIdempotencyKey_key" ON "SalesOrder"("organizationId", "completionIdempotencyKey");

-- CreateIndex
CREATE INDEX "SalesOrderItem_organizationId_salesOrderId_idx" ON "SalesOrderItem"("organizationId", "salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_organizationId_variantId_idx" ON "SalesOrderItem"("organizationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderItem_salesOrderId_variantId_key" ON "SalesOrderItem"("salesOrderId", "variantId");

-- CreateIndex
CREATE INDEX "SalesPayment_organizationId_salesOrderId_createdAt_id_idx" ON "SalesPayment"("organizationId", "salesOrderId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPayment_organizationId_idempotencyKey_key" ON "SalesPayment"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_salesOrderId_key" ON "InventoryTransaction"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_salesOrderId_organizationId_key" ON "InventoryTransaction"("salesOrderId", "organizationId");

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_salesOrderId_organizationId_fkey" FOREIGN KEY ("salesOrderId", "organizationId") REFERENCES "SalesOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesSequence" ADD CONSTRAINT "SalesSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_locationId_organizationId_fkey" FOREIGN KEY ("locationId", "organizationId") REFERENCES "Location"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrderId_organizationId_fkey" FOREIGN KEY ("salesOrderId", "organizationId") REFERENCES "SalesOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_variantId_organizationId_fkey" FOREIGN KEY ("variantId", "organizationId") REFERENCES "CatalogVariant"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPayment" ADD CONSTRAINT "SalesPayment_salesOrderId_organizationId_fkey" FOREIGN KEY ("salesOrderId", "organizationId") REFERENCES "SalesOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPayment" ADD CONSTRAINT "SalesPayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial and tenant integrity supplements Prisma's generated schema.
ALTER TABLE "SalesSequence" ADD CONSTRAINT sales_sequence_positive CHECK ("lastNumber" > 0);
ALTER TABLE "SalesOrder" ADD CONSTRAINT sales_order_totals CHECK (
  "sequenceNumber" > 0 AND subtotal >= 0 AND "discountTotal" >= 0 AND total >= 0
  AND subtotal <> 'NaN'::numeric AND total = subtotal - "discountTotal"
  AND (status::text = 'COMPLETED') = ("completedAt" IS NOT NULL)
  AND (status::text = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
  AND (status::text = 'COMPLETED') = ("completionIdempotencyKey" IS NOT NULL)
  AND ("completionIdempotencyKey" IS NULL) = ("completionRequestHash" IS NULL)
  AND (status::text <> 'COMPLETED' OR "locationId" IS NOT NULL)
);
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT sales_line_totals CHECK (
  quantity > 0 AND quantity <> 'NaN'::numeric AND "unitPrice" >= 0 AND "unitPrice" <> 'NaN'::numeric
  AND "discountAmount" >= 0 AND "discountAmount" <= round(quantity * "unitPrice",4)
  AND "lineTotal" = round(quantity * "unitPrice",4) - "discountAmount"
);
ALTER TABLE "SalesPayment" ADD CONSTRAINT sales_payment_positive CHECK (amount > 0 AND amount <> 'NaN'::numeric);
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT inventory_sale_source CHECK ((type::text = 'SALE') = ("salesOrderId" IS NOT NULL));

CREATE FUNCTION reject_sales_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Sales history is immutable' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER sales_payment_immutable BEFORE UPDATE OR DELETE ON "SalesPayment"
  FOR EACH ROW EXECUTE FUNCTION reject_sales_mutation();
CREATE TRIGGER sales_payment_no_truncate BEFORE TRUNCATE ON "SalesPayment"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_sales_mutation();
CREATE TRIGGER sales_order_no_delete BEFORE DELETE ON "SalesOrder"
  FOR EACH ROW EXECUTE FUNCTION reject_sales_mutation();
CREATE TRIGGER sales_order_no_truncate BEFORE TRUNCATE ON "SalesOrder"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_sales_mutation();
CREATE TRIGGER sales_item_no_truncate BEFORE TRUNCATE ON "SalesOrderItem"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_sales_mutation();
CREATE FUNCTION protect_sales_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status::text <> 'DRAFT' OR NEW.id <> OLD.id OR NEW."organizationId" <> OLD."organizationId"
    OR NEW."sequenceNumber" <> OLD."sequenceNumber" OR NEW."currencyCode" <> OLD."currencyCode"
    OR NEW."creationIdempotencyKey" <> OLD."creationIdempotencyKey" OR NEW."creationRequestHash" <> OLD."creationRequestHash"
    OR NEW."createdByUserId" <> OLD."createdByUserId" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Order is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER sales_order_immutable BEFORE UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION protect_sales_order();
CREATE FUNCTION protect_sales_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id uuid; org_id uuid; state text;
BEGIN
  IF TG_OP = 'DELETE' THEN order_id := OLD."salesOrderId"; org_id := OLD."organizationId";
  ELSE order_id := NEW."salesOrderId"; org_id := NEW."organizationId"; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."salesOrderId" <> OLD."salesOrderId" OR NEW."organizationId" <> OLD."organizationId") THEN
    RAISE EXCEPTION 'Cannot move an order item' USING ERRCODE = '23514';
  END IF;
  EXECUTE format('SELECT status::text FROM %I."SalesOrder" WHERE id=$1 AND "organizationId"=$2 FOR UPDATE',TG_TABLE_SCHEMA)
    INTO state USING order_id,org_id;
  IF state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Order is not draft' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER sales_item_draft_only BEFORE INSERT OR UPDATE OR DELETE ON "SalesOrderItem"
  FOR EACH ROW EXECUTE FUNCTION protect_sales_item();
CREATE FUNCTION validate_sales_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text; total numeric; paid numeric;
BEGIN
  EXECUTE format('SELECT status::text,total FROM %I."SalesOrder" WHERE id=$1 AND "organizationId"=$2 FOR UPDATE',TG_TABLE_SCHEMA)
    INTO state,total USING NEW."salesOrderId",NEW."organizationId";
  EXECUTE format('SELECT COALESCE(sum(amount),0) FROM %I."SalesPayment" WHERE "salesOrderId"=$1 AND "organizationId"=$2',TG_TABLE_SCHEMA)
    INTO paid USING NEW."salesOrderId",NEW."organizationId";
  IF state IS DISTINCT FROM 'COMPLETED' OR paid + NEW.amount > total THEN
    RAISE EXCEPTION 'Invalid payment state or amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER sales_payment_validate BEFORE INSERT ON "SalesPayment" FOR EACH ROW EXECUTE FUNCTION validate_sales_payment();
-- Deferred checks run after the whole completion, including optional payments.
CREATE FUNCTION validate_sales_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id uuid; actual record; expected record; movement_count integer;
BEGIN
  IF TG_TABLE_NAME = 'SalesOrder' THEN order_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN order_id := OLD."salesOrderId";
  ELSE order_id := NEW."salesOrderId"; END IF;
  EXECUTE format('SELECT * FROM %I."SalesOrder" WHERE id=$1',TG_TABLE_SCHEMA) INTO actual USING order_id;
  EXECUTE format('SELECT count(*) AS count, COALESCE(sum(round(quantity * "unitPrice",4)),0) AS subtotal,
    COALESCE(sum("discountAmount"),0) AS discount, count(*) FILTER (WHERE "stockDeducted") AS tracked FROM %I."SalesOrderItem" WHERE "salesOrderId"=$1',TG_TABLE_SCHEMA)
    INTO expected USING order_id;
  EXECUTE format('SELECT count(*) FROM %I."InventoryTransaction" WHERE "salesOrderId"=$1',TG_TABLE_SCHEMA)
    INTO movement_count USING order_id;
  IF actual.subtotal <> expected.subtotal OR actual."discountTotal" <> expected.discount
    OR expected.count > 100
    OR (actual.status::text = 'COMPLETED' AND expected.count = 0)
    OR (actual.status::text <> 'COMPLETED' AND (expected.tracked > 0 OR movement_count > 0))
    OR (actual.status::text = 'COMPLETED' AND movement_count <> CASE WHEN expected.tracked > 0 THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'Invalid sales order totals or movement' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER sales_order_validate AFTER INSERT OR UPDATE ON "SalesOrder"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_sales_order();
CREATE CONSTRAINT TRIGGER sales_items_validate AFTER INSERT OR UPDATE OR DELETE ON "SalesOrderItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_sales_order();
CREATE OR REPLACE FUNCTION validate_inventory_entries() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transaction_id uuid;
  kind text;
  original_id uuid;
  original_kind text;
  entry_count integer;
  variant_count integer;
  total numeric;
  mismatch boolean;
  sale_id uuid;
  sale_state text;
BEGIN
  IF TG_TABLE_NAME = 'InventoryTransaction' THEN transaction_id := NEW.id;
  ELSE transaction_id := NEW."transactionId"; END IF;
  EXECUTE format('SELECT type::text, "reversesTransactionId" FROM %I."InventoryTransaction" WHERE id = $1', TG_TABLE_SCHEMA)
    INTO kind, original_id USING transaction_id;
  EXECUTE format('SELECT count(*), count(DISTINCT "variantId"), sum("quantityDelta") FROM %I."InventoryLedgerEntry" WHERE "transactionId" = $1', TG_TABLE_SCHEMA)
    INTO entry_count, variant_count, total USING transaction_id;
  IF (kind IN ('OPENING_BALANCE', 'ADJUSTMENT') AND entry_count <> 1)
    OR (kind = 'OPENING_BALANCE' AND total <= 0)
    OR (kind = 'TRANSFER' AND (entry_count <> 2 OR variant_count <> 1 OR total <> 0)) THEN
    RAISE EXCEPTION 'Invalid inventory command entries' USING ERRCODE = '23514';
  END IF;
  IF kind = 'REVERSAL' THEN
    EXECUTE format('SELECT type::text FROM %I."InventoryTransaction" WHERE id = $1', TG_TABLE_SCHEMA)
      INTO original_kind USING original_id;
    EXECUTE format('SELECT EXISTS (
      (SELECT "locationId", "variantId", "quantityDelta" FROM %1$I."InventoryLedgerEntry" WHERE "transactionId" = $1
       EXCEPT ALL SELECT "locationId", "variantId", -"quantityDelta" FROM %1$I."InventoryLedgerEntry" WHERE "transactionId" = $2)
      UNION ALL
      (SELECT "locationId", "variantId", -"quantityDelta" FROM %1$I."InventoryLedgerEntry" WHERE "transactionId" = $2
       EXCEPT ALL SELECT "locationId", "variantId", "quantityDelta" FROM %1$I."InventoryLedgerEntry" WHERE "transactionId" = $1)
    )', TG_TABLE_SCHEMA) INTO mismatch USING transaction_id, original_id;
    IF original_kind IN ('REVERSAL','SALE') OR entry_count NOT IN (1, 2) OR mismatch THEN
      RAISE EXCEPTION 'Invalid inventory reversal entries' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF kind = 'SALE' THEN
    EXECUTE format('SELECT "salesOrderId" FROM %I."InventoryTransaction" WHERE id=$1',TG_TABLE_SCHEMA) INTO sale_id USING transaction_id;
    EXECUTE format('SELECT status::text FROM %I."SalesOrder" WHERE id=$1',TG_TABLE_SCHEMA) INTO sale_state USING sale_id;
    EXECUTE format('SELECT EXISTS (
      (SELECT e."locationId",e."variantId",e."quantityDelta" FROM %1$I."InventoryLedgerEntry" e WHERE e."transactionId"=$1
       EXCEPT ALL SELECT o."locationId",i."variantId",-i.quantity FROM %1$I."SalesOrderItem" i JOIN %1$I."SalesOrder" o ON o.id=i."salesOrderId" WHERE o.id=$2 AND i."stockDeducted")
      UNION ALL
      (SELECT o."locationId",i."variantId",-i.quantity FROM %1$I."SalesOrderItem" i JOIN %1$I."SalesOrder" o ON o.id=i."salesOrderId" WHERE o.id=$2 AND i."stockDeducted"
       EXCEPT ALL SELECT e."locationId",e."variantId",e."quantityDelta" FROM %1$I."InventoryLedgerEntry" e WHERE e."transactionId"=$1)
    )',TG_TABLE_SCHEMA) INTO mismatch USING transaction_id,sale_id;
    IF sale_state IS DISTINCT FROM 'COMPLETED' OR entry_count < 1 OR entry_count > 100 OR mismatch THEN
      RAISE EXCEPTION 'Invalid sale inventory entries' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

INSERT INTO "RolePermission" ("organizationId","roleId","permissionCode")
SELECT r."organizationId",r.id,p.code FROM "Role" r
CROSS JOIN (VALUES ('sales.view'),('sales.create'),('sales.manage'),('sales.complete'),('sales.payments.manage'),('customers.view'),('customers.manage')) p(code)
WHERE r."isSystem" AND (r.key IN ('OWNER','ADMIN') OR (r.key='MEMBER' AND p.code IN ('sales.view','customers.view')))
ON CONFLICT ("roleId","permissionCode") DO NOTHING;
