-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('OPENING_BALANCE', 'ADJUSTMENT', 'TRANSFER', 'REVERSAL');

-- CreateEnum
CREATE TYPE "InventoryAdjustmentReason" AS ENUM ('COUNT_CORRECTION', 'DAMAGE', 'LOSS', 'FOUND', 'OTHER');

-- CreateTable
CREATE TABLE "InventorySettings" (
    "organizationId" UUID NOT NULL,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventorySettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "InventoryTransactionType" NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "note" VARCHAR(2000),
    "reason" "InventoryAdjustmentReason",
    "reversesTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedgerEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantityDelta" DECIMAL(19,6) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_reversesTransactionId_key" ON "InventoryTransaction"("reversesTransactionId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_organizationId_createdAt_id_idx" ON "InventoryTransaction"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_id_organizationId_key" ON "InventoryTransaction"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_organizationId_idempotencyKey_key" ON "InventoryTransaction"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_organizationId_locationId_variantId_cr_idx" ON "InventoryLedgerEntry"("organizationId", "locationId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_organizationId_variantId_createdAt_idx" ON "InventoryLedgerEntry"("organizationId", "variantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLedgerEntry_transactionId_locationId_variantId_key" ON "InventoryLedgerEntry"("transactionId", "locationId", "variantId");

-- CreateIndex
CREATE INDEX "InventoryBalance_organizationId_variantId_idx" ON "InventoryBalance"("organizationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_organizationId_locationId_variantId_key" ON "InventoryBalance"("organizationId", "locationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_id_organizationId_key" ON "Location"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogVariant_id_organizationId_key" ON "CatalogVariant"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "InventorySettings" ADD CONSTRAINT "InventorySettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_reversesTransactionId_organizationId_fkey" FOREIGN KEY ("reversesTransactionId", "organizationId") REFERENCES "InventoryTransaction"("id", "organizationId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_transactionId_organizationId_fkey" FOREIGN KEY ("transactionId", "organizationId") REFERENCES "InventoryTransaction"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_locationId_organizationId_fkey" FOREIGN KEY ("locationId", "organizationId") REFERENCES "Location"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_variantId_organizationId_fkey" FOREIGN KEY ("variantId", "organizationId") REFERENCES "CatalogVariant"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_organizationId_fkey" FOREIGN KEY ("locationId", "organizationId") REFERENCES "Location"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_variantId_organizationId_fkey" FOREIGN KEY ("variantId", "organizationId") REFERENCES "CatalogVariant"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryBalance" ADD CONSTRAINT "inventory_balance_finite" CHECK ("quantity" <> 'NaN'::numeric);
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "inventory_delta_finite_nonzero" CHECK ("quantityDelta" <> 0 AND "quantityDelta" <> 'NaN'::numeric);
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "inventory_transaction_metadata" CHECK (
  ("type" = 'REVERSAL') = ("reversesTransactionId" IS NOT NULL)
  AND ("type" = 'ADJUSTMENT') = ("reason" IS NOT NULL)
  AND "reversesTransactionId" IS DISTINCT FROM "id"
);

CREATE FUNCTION reject_inventory_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "inventory_transaction_immutable" BEFORE UPDATE OR DELETE ON "InventoryTransaction"
  FOR EACH ROW EXECUTE FUNCTION reject_inventory_mutation();
CREATE TRIGGER "inventory_entry_immutable" BEFORE UPDATE OR DELETE ON "InventoryLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_inventory_mutation();
CREATE TRIGGER "inventory_transaction_no_truncate" BEFORE TRUNCATE ON "InventoryTransaction"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_mutation();
CREATE TRIGGER "inventory_entry_no_truncate" BEFORE TRUNCATE ON "InventoryLedgerEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_mutation();

-- Check the complete command at commit, after all its entries have been inserted.
-- Fixed entry cardinality also prevents appending entries to committed history.
CREATE FUNCTION validate_inventory_entries() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transaction_id uuid;
  kind text;
  original_id uuid;
  original_kind text;
  entry_count integer;
  variant_count integer;
  total numeric;
  mismatch boolean;
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
    IF original_kind = 'REVERSAL' OR entry_count NOT IN (1, 2) OR mismatch THEN
      RAISE EXCEPTION 'Invalid inventory reversal entries' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "inventory_transaction_entries" AFTER INSERT ON "InventoryTransaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_inventory_entries();
CREATE CONSTRAINT TRIGGER "inventory_entry_command" AFTER INSERT ON "InventoryLedgerEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_inventory_entries();

-- Stage 4 backfill: existing organizations and system roles, safe to repeat.
INSERT INTO "InventorySettings" ("organizationId", "allowNegativeStock", "updatedAt")
SELECT id, false, CURRENT_TIMESTAMP FROM "Organization"
ON CONFLICT ("organizationId") DO NOTHING;
INSERT INTO "RolePermission" ("organizationId", "roleId", "permissionCode")
SELECT r."organizationId", r.id, p.code FROM "Role" r
CROSS JOIN (VALUES ('inventory.view'), ('inventory.adjust'), ('inventory.transfer'), ('inventory.settings.manage')) AS p(code)
WHERE r."isSystem" AND (r.key IN ('OWNER', 'ADMIN') OR (r.key = 'MEMBER' AND p.code = 'inventory.view'))
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
