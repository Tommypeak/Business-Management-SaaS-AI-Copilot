-- Historical item types are unknown for pre-migration sales; never infer them from today's catalog.
ALTER TABLE "SalesOrderItem" ADD COLUMN "snapshotItemType" "CatalogItemType";
CREATE INDEX "SalesOrder_organizationId_completedAt_idx" ON "SalesOrder" ("organizationId", "completedAt");
CREATE INDEX "SalesOrder_organizationId_locationId_completedAt_idx" ON "SalesOrder" ("organizationId", "locationId", "completedAt");
CREATE INDEX "SalesPayment_organizationId_createdAt_idx" ON "SalesPayment" ("organizationId", "createdAt");
CREATE INDEX "InventoryLedgerEntry_organizationId_createdAt_idx" ON "InventoryLedgerEntry" ("organizationId", "createdAt");
CREATE INDEX "PurchaseOrder_organizationId_orderedAt_idx" ON "PurchaseOrder" ("organizationId", "orderedAt");
INSERT INTO "RolePermission" ("organizationId", "roleId", "permissionCode")
SELECT "organizationId", id, 'analytics.view' FROM "Role"
WHERE "isSystem" AND key IN ('OWNER', 'ADMIN')
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
