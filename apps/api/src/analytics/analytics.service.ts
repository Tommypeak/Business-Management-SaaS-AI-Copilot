import { Injectable } from '@nestjs/common';
import { Permission, type BusinessActivity, type ExecutiveOverviewResponse } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { timestampRange, location } from '../finance/calculations.js';
import { analyticsContext } from './analytics-query.js';
import type { AnalyticsQueryDto } from './analytics.dto.js';
import { InventoryAnalyticsService } from './inventory-analytics.service.js';
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryAnalyticsService,
  ) {}
  async overview(org: string, q: AnalyticsQueryDto): Promise<ExecutiveOverviewResponse> {
    const stock = await this.inventory.summary(org, q),
      c = stock.context,
      s = this.prisma.sqlSchema;
    const [row] = await this.prisma.$queryRaw<
      { completedOrders: number; partiallyReceivedOrders: number }[]
    >(Prisma.sql`
      SELECT (SELECT count(*)::int FROM ${s}."SalesOrder" o WHERE o."organizationId"=${org}::uuid AND o.status='COMPLETED'
        ${timestampRange(Prisma.sql`o."completedAt"`, c, c.timezone)} ${location(Prisma.sql`o."locationId"`, c.locationId)}) AS "completedOrders",
        (SELECT count(*)::int FROM ${s}."PurchaseOrder" o WHERE o."organizationId"=${org}::uuid AND o.status='PARTIALLY_RECEIVED'
        ${timestampRange(Prisma.sql`o."orderedAt"`, c, c.timezone)} ${location(Prisma.sql`o."destinationLocationId"`, c.locationId)}) AS "partiallyReceivedOrders"`);
    return {
      context: c,
      ...row!,
      trackedVariants: stock.trackedVariants,
      negativeStock: stock.negativeStock,
      zeroStock: stock.zeroStock,
    };
  }
  async activity(tenant: OrganizationContext, q: AnalyticsQueryDto): Promise<BusinessActivity[]> {
    const org = tenant.organizationId,
      s = this.prisma.sqlSchema;
    return this.prisma.$transaction(async (tx) => {
      const c = await analyticsContext(tx, org, q),
        parts: Prisma.Sql[] = [];
      if ((!q.kind || q.kind === 'SALE') && tenant.permissions.includes(Permission.SALES_VIEW))
        parts.push(Prisma.sql`
        (SELECT o.id,'SALE' AS kind,'Sale #'||o."sequenceNumber" AS label,o."completedAt" AS at,NULL::date AS day,'sales/'||o.id AS href
        FROM ${s}."SalesOrder" o WHERE o."organizationId"=${org}::uuid AND o.status='COMPLETED' ${timestampRange(Prisma.sql`o."completedAt"`, c, c.timezone)} ${location(Prisma.sql`o."locationId"`, c.locationId)} ORDER BY at DESC,o.id LIMIT ${q.limit})`);
      if (
        (!q.kind || q.kind === 'RECEIPT') &&
        tenant.permissions.includes(Permission.PURCHASING_VIEW)
      )
        parts.push(Prisma.sql`
        (SELECT r.id,'RECEIPT' AS kind,'Goods receipt #'||r."sequenceNumber" AS label,r."receivedAt" AS at,NULL::date AS day,'purchasing/receipts/'||r.id AS href
        FROM ${s}."GoodsReceipt" r JOIN ${s}."PurchaseOrder" o ON o.id=r."purchaseOrderId" AND o."organizationId"=r."organizationId"
        WHERE r."organizationId"=${org}::uuid ${timestampRange(Prisma.sql`r."receivedAt"`, c, c.timezone)} ${location(Prisma.sql`o."destinationLocationId"`, c.locationId)} ORDER BY at DESC,r.id LIMIT ${q.limit})`);
      if (
        (!q.kind || q.kind === 'INVENTORY') &&
        tenant.permissions.includes(Permission.INVENTORY_VIEW)
      )
        parts.push(Prisma.sql`
        (SELECT t.id,'INVENTORY' AS kind,t.type::text AS label,t."createdAt" AS at,NULL::date AS day,'inventory/history/'||t.id AS href FROM ${s}."InventoryTransaction" t
        WHERE t."organizationId"=${org}::uuid ${timestampRange(Prisma.sql`t."createdAt"`, c, c.timezone)}
        ${c.locationId ? Prisma.sql`AND EXISTS(SELECT 1 FROM ${s}."InventoryLedgerEntry" e WHERE e."transactionId"=t.id AND e."organizationId"=${org}::uuid AND e."locationId"=${c.locationId}::uuid)` : Prisma.empty}
        ORDER BY at DESC,t.id LIMIT ${q.limit})`);
      if (
        (!q.kind || q.kind === 'EXPENSE') &&
        tenant.permissions.includes(Permission.FINANCE_VIEW) &&
        tenant.permissions.includes(Permission.EXPENSES_VIEW)
      )
        parts.push(Prisma.sql`
        (SELECT e.id,'EXPENSE' AS kind,'Expense posted #'||e."sequenceNumber" AS label,e."postedAt" AS at,e."expenseDate" AS day,'expenses/'||e.id AS href FROM ${s}."Expense" e
        WHERE e."organizationId"=${org}::uuid AND e.status='POSTED' ${timestampRange(Prisma.sql`e."postedAt"`, c, c.timezone)} ${location(Prisma.sql`e."locationId"`, c.locationId)} ORDER BY at DESC,e.id LIMIT ${q.limit})`);
      if (
        (!q.kind || q.kind === 'SUPPLIER_PAYMENT') &&
        !c.locationId &&
        tenant.permissions.includes(Permission.FINANCE_VIEW) &&
        tenant.permissions.includes(Permission.ACCOUNTS_PAYABLE_VIEW)
      )
        parts.push(Prisma.sql`
        (SELECT p.id,'SUPPLIER_PAYMENT' AS kind,'Supplier payment recorded' AS label,p."createdAt" AS at,p."paymentDate" AS day,'accounts-payable/'||p."supplierBillId" AS href FROM ${s}."SupplierPayment" p
        WHERE p."organizationId"=${org}::uuid ${timestampRange(Prisma.sql`p."createdAt"`, c, c.timezone)} ORDER BY at DESC,p.id LIMIT ${q.limit})`);
      if (!parts.length) return [];
      const rows = await tx.$queryRaw<
        {
          id: string;
          kind: BusinessActivity['kind'];
          label: string;
          at: Date;
          day: Date | null;
          href: string;
        }[]
      >(
        Prisma.sql`SELECT * FROM (${Prisma.join(parts, ' UNION ALL ')}) events ORDER BY at DESC,id LIMIT ${q.limit}`,
      );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label,
        recordedAt: r.at.toISOString(),
        businessDate: r.day?.toISOString().slice(0, 10) ?? null,
        href: `/app/${org}/${r.href}`,
      }));
    });
  }
}
