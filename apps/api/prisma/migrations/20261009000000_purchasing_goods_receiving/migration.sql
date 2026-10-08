-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'PURCHASE_RECEIPT';

-- AlterTable
ALTER TABLE "InventoryTransaction" ADD COLUMN     "goodsReceiptId" UUID;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contactName" VARCHAR(200),
    "email" VARCHAR(254),
    "phone" VARCHAR(50),
    "taxId" VARCHAR(100),
    "address" VARCHAR(1000),
    "notes" VARCHAR(2000),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseSequence" (
    "organizationId" UUID NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseSequence_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "GoodsReceiptSequence" (
    "organizationId" UUID NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GoodsReceiptSequence_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "supplierId" UUID NOT NULL,
    "destinationLocationId" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currencyCode" CHAR(3) NOT NULL,
    "note" VARCHAR(2000),
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "orderedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "creationIdempotencyKey" UUID NOT NULL,
    "creationRequestHash" CHAR(64) NOT NULL,
    "orderingIdempotencyKey" UUID,
    "orderingRequestHash" CHAR(64),

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "orderedQuantity" DECIMAL(19,6) NOT NULL,
    "unitCost" DECIMAL(19,4) NOT NULL,
    "lineTotal" DECIMAL(19,4) NOT NULL,
    "snapshotItemName" VARCHAR(200) NOT NULL,
    "snapshotVariantName" VARCHAR(120),
    "snapshotSku" VARCHAR(80),
    "snapshotUnit" "UnitOfMeasure" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "note" VARCHAR(2000),
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "goodsReceiptId" UUID NOT NULL,
    "purchaseOrderItemId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "receivedQuantity" DECIMAL(19,6) NOT NULL,
    "snapshotUnit" "UnitOfMeasure" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_organizationId_createdAt_id_idx" ON "Supplier"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_isActive_createdAt_id_idx" ON "Supplier"("organizationId", "isActive", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_organizationId_key" ON "Supplier"("id", "organizationId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_createdAt_id_idx" ON "PurchaseOrder"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_status_createdAt_id_idx" ON "PurchaseOrder"("organizationId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_supplierId_idx" ON "PurchaseOrder"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_destinationLocationId_idx" ON "PurchaseOrder"("organizationId", "destinationLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_organizationId_key" ON "PurchaseOrder"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_sequenceNumber_key" ON "PurchaseOrder"("organizationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_creationIdempotencyKey_key" ON "PurchaseOrder"("organizationId", "creationIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_orderingIdempotencyKey_key" ON "PurchaseOrder"("organizationId", "orderingIdempotencyKey");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_organizationId_purchaseOrderId_idx" ON "PurchaseOrderItem"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_organizationId_variantId_idx" ON "PurchaseOrderItem"("organizationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_id_organizationId_key" ON "PurchaseOrderItem"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_variantId_key" ON "PurchaseOrderItem"("purchaseOrderId", "variantId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_organizationId_purchaseOrderId_idx" ON "GoodsReceipt"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_organizationId_receivedAt_id_idx" ON "GoodsReceipt"("organizationId", "receivedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_id_organizationId_key" ON "GoodsReceipt"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organizationId_sequenceNumber_key" ON "GoodsReceipt"("organizationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organizationId_idempotencyKey_key" ON "GoodsReceipt"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_organizationId_goodsReceiptId_idx" ON "GoodsReceiptItem"("organizationId", "goodsReceiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_organizationId_purchaseOrderItemId_idx" ON "GoodsReceiptItem"("organizationId", "purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptItem_goodsReceiptId_purchaseOrderItemId_key" ON "GoodsReceiptItem"("goodsReceiptId", "purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_goodsReceiptId_key" ON "InventoryTransaction"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_goodsReceiptId_organizationId_key" ON "InventoryTransaction"("goodsReceiptId", "organizationId");

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_goodsReceiptId_organizationId_fkey" FOREIGN KEY ("goodsReceiptId", "organizationId") REFERENCES "GoodsReceipt"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseSequence" ADD CONSTRAINT "PurchaseSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptSequence" ADD CONSTRAINT "GoodsReceiptSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_destinationLocationId_organizationId_fkey" FOREIGN KEY ("destinationLocationId", "organizationId") REFERENCES "Location"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_organizationId_fkey" FOREIGN KEY ("purchaseOrderId", "organizationId") REFERENCES "PurchaseOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_variantId_organizationId_fkey" FOREIGN KEY ("variantId", "organizationId") REFERENCES "CatalogVariant"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_organizationId_fkey" FOREIGN KEY ("purchaseOrderId", "organizationId") REFERENCES "PurchaseOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_goodsReceiptId_organizationId_fkey" FOREIGN KEY ("goodsReceiptId", "organizationId") REFERENCES "GoodsReceipt"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_purchaseOrderItemId_organizationId_fkey" FOREIGN KEY ("purchaseOrderItemId", "organizationId") REFERENCES "PurchaseOrderItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_variantId_organizationId_fkey" FOREIGN KEY ("variantId", "organizationId") REFERENCES "CatalogVariant"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stage 6 domain and tenant integrity.
ALTER TABLE "PurchaseSequence" ADD CONSTRAINT purchase_sequence_positive CHECK ("lastNumber" > 0);
ALTER TABLE "GoodsReceiptSequence" ADD CONSTRAINT receipt_sequence_positive CHECK ("lastNumber" > 0);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT purchase_order_totals CHECK (
  "sequenceNumber" > 0 AND subtotal >= 0 AND subtotal <> 'NaN'::numeric AND total = subtotal
  AND (status IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED') OR (status = 'CANCELLED' AND "orderedAt" IS NOT NULL)) = ("orderedAt" IS NOT NULL)
  AND (status = 'RECEIVED') = ("completedAt" IS NOT NULL)
  AND (status = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
  AND ("orderingIdempotencyKey" IS NULL) = ("orderingRequestHash" IS NULL)
);
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT purchase_line_totals CHECK (
  "orderedQuantity" > 0 AND "orderedQuantity" <> 'NaN'::numeric
  AND "unitCost" >= 0 AND "unitCost" <> 'NaN'::numeric
  AND "lineTotal" = round("orderedQuantity" * "unitCost",4)
);
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT goods_receipt_number_positive CHECK ("sequenceNumber" > 0);
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT goods_receipt_quantity_positive CHECK ("receivedQuantity" > 0 AND "receivedQuantity" <> 'NaN'::numeric);
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT inventory_purchase_source CHECK ((type::text = 'PURCHASE_RECEIPT') = ("goodsReceiptId" IS NOT NULL));

CREATE FUNCTION reject_purchase_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Purchase history is immutable' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER receipt_immutable BEFORE UPDATE OR DELETE ON "GoodsReceipt"
  FOR EACH ROW EXECUTE FUNCTION reject_purchase_history_mutation();
CREATE TRIGGER receipt_item_immutable BEFORE UPDATE OR DELETE ON "GoodsReceiptItem"
  FOR EACH ROW EXECUTE FUNCTION reject_purchase_history_mutation();
CREATE TRIGGER receipt_no_truncate BEFORE TRUNCATE ON "GoodsReceipt"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_purchase_history_mutation();
CREATE TRIGGER receipt_item_no_truncate BEFORE TRUNCATE ON "GoodsReceiptItem"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_purchase_history_mutation();
CREATE TRIGGER purchase_order_no_delete BEFORE DELETE ON "PurchaseOrder"
  FOR EACH ROW EXECUTE FUNCTION reject_purchase_history_mutation();
CREATE TRIGGER purchase_item_no_truncate BEFORE TRUNCATE ON "PurchaseOrderItem"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_purchase_history_mutation();

CREATE FUNCTION protect_purchase_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW."organizationId" <> OLD."organizationId"
    OR NEW."sequenceNumber" <> OLD."sequenceNumber" OR NEW."currencyCode" <> OLD."currencyCode"
    OR NEW."creationIdempotencyKey" <> OLD."creationIdempotencyKey" OR NEW."creationRequestHash" <> OLD."creationRequestHash"
    OR NEW."createdByUserId" <> OLD."createdByUserId" OR NEW."createdAt" <> OLD."createdAt"
    OR (OLD.status <> 'DRAFT' AND (
      NEW."supplierId" <> OLD."supplierId" OR NEW."destinationLocationId" <> OLD."destinationLocationId"
      OR NEW.note IS DISTINCT FROM OLD.note OR NEW.subtotal <> OLD.subtotal OR NEW.total <> OLD.total
      OR NEW."orderedAt" IS DISTINCT FROM OLD."orderedAt"
      OR NEW."orderingIdempotencyKey" IS DISTINCT FROM OLD."orderingIdempotencyKey"
      OR NEW."orderingRequestHash" IS DISTINCT FROM OLD."orderingRequestHash"
    )) THEN RAISE EXCEPTION 'Purchase order is immutable' USING ERRCODE = '23514'; END IF;
  IF (OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT','ORDERED','CANCELLED'))
    OR (OLD.status = 'ORDERED' AND NEW.status NOT IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'))
    OR (OLD.status = 'PARTIALLY_RECEIVED' AND NEW.status NOT IN ('PARTIALLY_RECEIVED','RECEIVED'))
    OR (OLD.status IN ('RECEIVED','CANCELLED') AND NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'Invalid purchase order transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER purchase_order_immutable BEFORE UPDATE ON "PurchaseOrder"
  FOR EACH ROW EXECUTE FUNCTION protect_purchase_order();

CREATE FUNCTION protect_purchase_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id uuid; org_id uuid; state text;
BEGIN
  IF TG_OP = 'DELETE' THEN order_id := OLD."purchaseOrderId"; org_id := OLD."organizationId";
  ELSE order_id := NEW."purchaseOrderId"; org_id := NEW."organizationId"; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."purchaseOrderId" <> OLD."purchaseOrderId" OR NEW."organizationId" <> OLD."organizationId") THEN
    RAISE EXCEPTION 'Cannot move purchase line' USING ERRCODE = '23514'; END IF;
  EXECUTE format('SELECT status::text FROM %I."PurchaseOrder" WHERE id=$1 AND "organizationId"=$2 FOR UPDATE',TG_TABLE_SCHEMA)
    INTO state USING order_id,org_id;
  IF state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Purchase order is not draft' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER purchase_item_draft_only BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseOrderItem"
  FOR EACH ROW EXECUTE FUNCTION protect_purchase_item();

CREATE FUNCTION validate_receipt_item_relation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_order uuid; line_order uuid; line_variant uuid; line_unit text;
BEGIN
  EXECUTE format('SELECT "purchaseOrderId" FROM %I."GoodsReceipt" WHERE id=$1 AND "organizationId"=$2',TG_TABLE_SCHEMA)
    INTO receipt_order USING NEW."goodsReceiptId",NEW."organizationId";
  EXECUTE format('SELECT "purchaseOrderId","variantId","snapshotUnit"::text FROM %I."PurchaseOrderItem" WHERE id=$1 AND "organizationId"=$2',TG_TABLE_SCHEMA)
    INTO line_order,line_variant,line_unit USING NEW."purchaseOrderItemId",NEW."organizationId";
  IF receipt_order IS DISTINCT FROM line_order OR line_variant IS DISTINCT FROM NEW."variantId"
    OR line_unit IS DISTINCT FROM NEW."snapshotUnit"::text THEN
    RAISE EXCEPTION 'Receipt line does not belong to purchase order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER receipt_item_relation BEFORE INSERT ON "GoodsReceiptItem"
  FOR EACH ROW EXECUTE FUNCTION validate_receipt_item_relation();

-- Deferred validation sees the final receipt, status, and inventory movement in one transaction.
CREATE FUNCTION validate_purchase_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id uuid; po_id uuid; state text; bad boolean; tracked_count integer; movement_id uuid; mismatch boolean;
BEGIN
  IF TG_TABLE_NAME = 'GoodsReceipt' THEN receipt_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'GoodsReceiptItem' THEN receipt_id := NEW."goodsReceiptId";
  ELSE receipt_id := NEW."goodsReceiptId"; END IF;
  IF receipt_id IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT "purchaseOrderId" FROM %I."GoodsReceipt" WHERE id=$1',TG_TABLE_SCHEMA) INTO po_id USING receipt_id;
  EXECUTE format('SELECT status::text FROM %I."PurchaseOrder" WHERE id=$1',TG_TABLE_SCHEMA) INTO state USING po_id;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %1$I."PurchaseOrderItem" i
    LEFT JOIN (SELECT "purchaseOrderItemId",sum("receivedQuantity") AS qty FROM %1$I."GoodsReceiptItem" GROUP BY "purchaseOrderItemId") r ON r."purchaseOrderItemId"=i.id
    WHERE i."purchaseOrderId"=$1 AND COALESCE(r.qty,0)>i."orderedQuantity")',TG_TABLE_SCHEMA) INTO bad USING po_id;
  IF bad OR state NOT IN ('PARTIALLY_RECEIVED','RECEIVED') THEN
    RAISE EXCEPTION 'Invalid purchase receiving state or quantity' USING ERRCODE = '23514'; END IF;
  EXECUTE format('SELECT count(*) FROM %1$I."GoodsReceiptItem" ri
    JOIN %1$I."CatalogVariant" v ON v.id=ri."variantId"
    JOIN %1$I."CatalogItem" ci ON ci.id=v."catalogItemId"
    WHERE ri."goodsReceiptId"=$1 AND ci."trackInventory"',TG_TABLE_SCHEMA) INTO tracked_count USING receipt_id;
  EXECUTE format('SELECT id FROM %I."InventoryTransaction" WHERE "goodsReceiptId"=$1',TG_TABLE_SCHEMA) INTO movement_id USING receipt_id;
  IF (tracked_count > 0) IS DISTINCT FROM (movement_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Missing purchase inventory movement' USING ERRCODE = '23514'; END IF;
  IF movement_id IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS (
      (SELECT e."locationId",e."variantId",e."quantityDelta" FROM %1$I."InventoryLedgerEntry" e WHERE e."transactionId"=$1
       EXCEPT ALL SELECT o."destinationLocationId",ri."variantId",ri."receivedQuantity" FROM %1$I."GoodsReceiptItem" ri
       JOIN %1$I."GoodsReceipt" gr ON gr.id=ri."goodsReceiptId" JOIN %1$I."PurchaseOrder" o ON o.id=gr."purchaseOrderId"
       JOIN %1$I."CatalogVariant" v ON v.id=ri."variantId" JOIN %1$I."CatalogItem" ci ON ci.id=v."catalogItemId"
       WHERE gr.id=$2 AND ci."trackInventory")
      UNION ALL
      (SELECT o."destinationLocationId",ri."variantId",ri."receivedQuantity" FROM %1$I."GoodsReceiptItem" ri
       JOIN %1$I."GoodsReceipt" gr ON gr.id=ri."goodsReceiptId" JOIN %1$I."PurchaseOrder" o ON o.id=gr."purchaseOrderId"
       JOIN %1$I."CatalogVariant" v ON v.id=ri."variantId" JOIN %1$I."CatalogItem" ci ON ci.id=v."catalogItemId"
       WHERE gr.id=$2 AND ci."trackInventory"
       EXCEPT ALL SELECT e."locationId",e."variantId",e."quantityDelta" FROM %1$I."InventoryLedgerEntry" e WHERE e."transactionId"=$1)
    )',TG_TABLE_SCHEMA) INTO mismatch USING movement_id,receipt_id;
    IF mismatch THEN RAISE EXCEPTION 'Invalid purchase inventory entries' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER receipt_complete AFTER INSERT ON "GoodsReceipt"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_purchase_receipt();
CREATE CONSTRAINT TRIGGER receipt_item_complete AFTER INSERT ON "GoodsReceiptItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_purchase_receipt();
CREATE CONSTRAINT TRIGGER receipt_inventory_complete AFTER INSERT ON "InventoryTransaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_purchase_receipt();

INSERT INTO "RolePermission" ("organizationId","roleId","permissionCode")
SELECT r."organizationId",r.id,p.code FROM "Role" r
CROSS JOIN (VALUES ('suppliers.view'),('suppliers.manage'),('purchasing.view'),('purchasing.create'),('purchasing.manage'),('purchasing.receive')) p(code)
WHERE r."isSystem" AND (r.key IN ('OWNER','ADMIN') OR (r.key='MEMBER' AND p.code IN ('suppliers.view','purchasing.view')))
ON CONFLICT ("roleId","permissionCode") DO NOTHING;
