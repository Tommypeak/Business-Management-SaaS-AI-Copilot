-- CreateEnum
CREATE TYPE "CatalogItemType" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "UnitOfMeasure" AS ENUM ('PIECE', 'KILOGRAM', 'GRAM', 'LITER', 'MILLILITER', 'METER', 'CENTIMETER', 'HOUR', 'MINUTE', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT', 'MULTI_SELECT');

-- CreateTable
CREATE TABLE "CatalogCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "parentId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "CatalogItemType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "categoryId" UUID,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogVariant" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "name" VARCHAR(120),
    "sku" VARCHAR(80),
    "barcode" VARCHAR(120),
    "sellingPrice" DECIMAL(19,4) NOT NULL,
    "costPrice" DECIMAL(19,4),
    "unit" "UnitOfMeasure" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CatalogVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogOption" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CatalogOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogOptionValue" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "value" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CatalogOptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantOptionValue" (
    "organizationId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "optionValueId" UUID NOT NULL,

    CONSTRAINT "VariantOptionValue_pkey" PRIMARY KEY ("variantId","optionId")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldOption" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "fieldDefinitionId" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "value" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CustomFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemCustomFieldValue" (
    "organizationId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "fieldDefinitionId" UUID NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "CatalogItemCustomFieldValue_pkey" PRIMARY KEY ("catalogItemId","fieldDefinitionId")
);

-- CreateIndex
CREATE INDEX "CatalogCategory_organizationId_isActive_id_idx" ON "CatalogCategory"("organizationId", "isActive", "id");

-- CreateIndex
CREATE INDEX "CatalogCategory_parentId_organizationId_idx" ON "CatalogCategory"("parentId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCategory_id_organizationId_key" ON "CatalogCategory"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CatalogItem_organizationId_isActive_createdAt_id_idx" ON "CatalogItem"("organizationId", "isActive", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CatalogItem_organizationId_categoryId_idx" ON "CatalogItem"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "CatalogItem_organizationId_type_idx" ON "CatalogItem"("organizationId", "type");

-- CreateIndex
CREATE INDEX "CatalogItem_organizationId_name_id_idx" ON "CatalogItem"("organizationId", "name", "id");

-- CreateIndex
CREATE INDEX "CatalogItem_organizationId_updatedAt_id_idx" ON "CatalogItem"("organizationId", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_id_organizationId_key" ON "CatalogItem"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CatalogVariant_catalogItemId_organizationId_id_idx" ON "CatalogVariant"("catalogItemId", "organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogVariant_id_catalogItemId_organizationId_key" ON "CatalogVariant"("id", "catalogItemId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogVariant_organizationId_sku_key" ON "CatalogVariant"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogVariant_organizationId_barcode_key" ON "CatalogVariant"("organizationId", "barcode");

-- CreateIndex
CREATE INDEX "CatalogOption_organizationId_catalogItemId_idx" ON "CatalogOption"("organizationId", "catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOption_id_catalogItemId_organizationId_key" ON "CatalogOption"("id", "catalogItemId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOption_catalogItemId_name_key" ON "CatalogOption"("catalogItemId", "name");

-- CreateIndex
CREATE INDEX "CatalogOptionValue_organizationId_catalogItemId_idx" ON "CatalogOptionValue"("organizationId", "catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOptionValue_id_optionId_catalogItemId_organizationId_key" ON "CatalogOptionValue"("id", "optionId", "catalogItemId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOptionValue_optionId_value_key" ON "CatalogOptionValue"("optionId", "value");

-- CreateIndex
CREATE INDEX "VariantOptionValue_optionValueId_optionId_catalogItemId_org_idx" ON "VariantOptionValue"("optionValueId", "optionId", "catalogItemId", "organizationId");

-- CreateIndex
CREATE INDEX "VariantOptionValue_organizationId_catalogItemId_idx" ON "VariantOptionValue"("organizationId", "catalogItemId");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_organizationId_isActive_id_idx" ON "CustomFieldDefinition"("organizationId", "isActive", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_id_organizationId_key" ON "CustomFieldDefinition"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_key_key" ON "CustomFieldDefinition"("organizationId", "key");

-- CreateIndex
CREATE INDEX "CustomFieldOption_organizationId_fieldDefinitionId_idx" ON "CustomFieldOption"("organizationId", "fieldDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldOption_fieldDefinitionId_value_key" ON "CustomFieldOption"("fieldDefinitionId", "value");

-- CreateIndex
CREATE INDEX "CatalogItemCustomFieldValue_organizationId_fieldDefinitionI_idx" ON "CatalogItemCustomFieldValue"("organizationId", "fieldDefinitionId");

-- AddForeignKey
ALTER TABLE "CatalogCategory" ADD CONSTRAINT "CatalogCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCategory" ADD CONSTRAINT "CatalogCategory_parentId_organizationId_fkey" FOREIGN KEY ("parentId", "organizationId") REFERENCES "CatalogCategory"("id", "organizationId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_categoryId_organizationId_fkey" FOREIGN KEY ("categoryId", "organizationId") REFERENCES "CatalogCategory"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogVariant" ADD CONSTRAINT "CatalogVariant_catalogItemId_organizationId_fkey" FOREIGN KEY ("catalogItemId", "organizationId") REFERENCES "CatalogItem"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogOption" ADD CONSTRAINT "CatalogOption_catalogItemId_organizationId_fkey" FOREIGN KEY ("catalogItemId", "organizationId") REFERENCES "CatalogItem"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogOptionValue" ADD CONSTRAINT "CatalogOptionValue_optionId_catalogItemId_organizationId_fkey" FOREIGN KEY ("optionId", "catalogItemId", "organizationId") REFERENCES "CatalogOption"("id", "catalogItemId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantOptionValue" ADD CONSTRAINT "VariantOptionValue_variantId_catalogItemId_organizationId_fkey" FOREIGN KEY ("variantId", "catalogItemId", "organizationId") REFERENCES "CatalogVariant"("id", "catalogItemId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantOptionValue" ADD CONSTRAINT "VariantOptionValue_optionValueId_optionId_catalogItemId_or_fkey" FOREIGN KEY ("optionValueId", "optionId", "catalogItemId", "organizationId") REFERENCES "CatalogOptionValue"("id", "optionId", "catalogItemId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldOption" ADD CONSTRAINT "CustomFieldOption_fieldDefinitionId_organizationId_fkey" FOREIGN KEY ("fieldDefinitionId", "organizationId") REFERENCES "CustomFieldDefinition"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemCustomFieldValue" ADD CONSTRAINT "CatalogItemCustomFieldValue_catalogItemId_organizationId_fkey" FOREIGN KEY ("catalogItemId", "organizationId") REFERENCES "CatalogItem"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemCustomFieldValue" ADD CONSTRAINT "CatalogItemCustomFieldValue_fieldDefinitionId_organization_fkey" FOREIGN KEY ("fieldDefinitionId", "organizationId") REFERENCES "CustomFieldDefinition"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants not expressible in the Prisma schema.
ALTER TABLE "CatalogItem" ADD CONSTRAINT "service_no_inventory" CHECK ("type" <> 'SERVICE' OR NOT "trackInventory");
ALTER TABLE "CatalogCategory" ADD CONSTRAINT "category_not_self_parent" CHECK ("parentId" IS DISTINCT FROM "id");
ALTER TABLE "CatalogVariant" ADD CONSTRAINT "variant_nonnegative_prices" CHECK ("sellingPrice" >= 0 AND ("costPrice" IS NULL OR "costPrice" >= 0));
ALTER TABLE "CatalogVariant" ADD CONSTRAINT "default_variant_active" CHECK (NOT "isDefault" OR "isActive");
CREATE UNIQUE INDEX "CatalogVariant_one_default" ON "CatalogVariant" ("catalogItemId") WHERE "isDefault";

-- Deferred so item and default variant can be inserted within one transaction.
-- Schema comes from PostgreSQL trigger metadata, never from a request.
CREATE FUNCTION enforce_catalog_default() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item_id uuid;
  item_ids uuid[];
  item_exists boolean;
  default_count integer;
BEGIN
  IF TG_TABLE_NAME = 'CatalogItem' THEN
    item_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    item_ids := ARRAY[NEW."catalogItemId"];
  ELSIF TG_OP = 'DELETE' THEN
    item_ids := ARRAY[OLD."catalogItemId"];
  ELSE
    item_ids := ARRAY[OLD."catalogItemId", NEW."catalogItemId"];
  END IF;
  FOREACH item_id IN ARRAY item_ids LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."CatalogItem" WHERE id = $1)', TG_TABLE_SCHEMA)
      INTO item_exists USING item_id;
    IF item_exists THEN
      EXECUTE format('SELECT count(*) FROM %I."CatalogVariant" WHERE "catalogItemId" = $1 AND "isDefault"', TG_TABLE_SCHEMA)
        INTO default_count USING item_id;
      IF default_count <> 1 THEN
        RAISE EXCEPTION 'Catalog item must have exactly one default variant' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "catalog_item_default_required" AFTER INSERT OR UPDATE ON "CatalogItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_catalog_default();
CREATE CONSTRAINT TRIGGER "catalog_variant_default_required" AFTER INSERT OR UPDATE OR DELETE ON "CatalogVariant"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_catalog_default();

-- Existing system roles receive the same permissions as newly created roles.
INSERT INTO "RolePermission" ("organizationId", "roleId", "permissionCode")
SELECT r."organizationId", r.id, p.code
FROM "Role" r
CROSS JOIN (VALUES ('catalog.view'), ('catalog.manage')) AS p(code)
WHERE r."isSystem" AND (r.key IN ('OWNER', 'ADMIN') OR (r.key = 'MEMBER' AND p.code = 'catalog.view'))
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
