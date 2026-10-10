import { Injectable } from '@nestjs/common';
import type { AnalyticsContext, PurchasingAnalyticsSummary, ReceivingLine } from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { timestampRange, location, singleCurrency } from '../finance/calculations.js';
import { decimal } from '../sales/totals.js';
import { analyticsContext, amount, comparison, bucket, buckets } from './analytics-query.js';
import type { AnalyticsQueryDto } from './analytics.dto.js';
@Injectable()
export class PurchasingAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}
  private scope(org: string, c: AnalyticsContext) {
    return Prisma.sql`o."organizationId"=${org}::uuid AND o.status IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED')
      ${timestampRange(Prisma.sql`o."orderedAt"`, c, c.timezone)} ${location(Prisma.sql`o."destinationLocationId"`, c.locationId)}`;
  }
  private lines(org: string, c: AnalyticsContext) {
    const s = this.prisma.sqlSchema;
    return Prisma.sql`SELECT i.id, i."purchaseOrderId", o."sequenceNumber", i."snapshotItemName", i."snapshotUnit", i."orderedQuantity", COALESCE(r.received,0) AS received
      FROM ${s}."PurchaseOrderItem" i JOIN ${s}."PurchaseOrder" o ON o.id=i."purchaseOrderId" AND o."organizationId"=i."organizationId"
      LEFT JOIN (SELECT "purchaseOrderItemId", SUM("receivedQuantity") AS received FROM ${s}."GoodsReceiptItem" WHERE "organizationId"=${org}::uuid GROUP BY "purchaseOrderItemId") r ON r."purchaseOrderItemId"=i.id
      WHERE ${this.scope(org, c)}`;
  }
  async summary(org: string, q: AnalyticsQueryDto): Promise<PurchasingAnalyticsSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q),
          s = this.prisma.sqlSchema;
        const totals = await tx.$queryRaw<
          {
            currencyCode: string;
            amount: Prisma.Decimal;
            count: number;
            partial: number;
            complete: number;
            open: number;
            period: string;
          }[]
        >(Prisma.sql`
        SELECT o."currencyCode", SUM(o.total) AS amount, count(*)::int AS count,
          count(*) FILTER (WHERE o.status='PARTIALLY_RECEIVED')::int AS partial,
          count(*) FILTER (WHERE o.status='RECEIVED')::int AS complete,
          count(*) FILTER (WHERE o.status IN ('ORDERED','PARTIALLY_RECEIVED'))::int AS open,
          CASE WHEN o."orderedAt">=(${c.from}::date::timestamp AT TIME ZONE ${c.timezone}) THEN 'current' ELSE 'previous' END AS period
        FROM ${s}."PurchaseOrder" o WHERE ${this.scope(org, { ...c, from: c.previous.from })} GROUP BY o."currencyCode",period`);
        const currencyCode = singleCurrency(totals, c.defaultCurrency),
          cur = totals.find((r) => r.period === 'current'),
          prev = totals.find((r) => r.period === 'previous');
        const [lineCounts] = await tx.$queryRaw<{ count: number; complete: number }[]>(
          Prisma.sql`WITH lines AS (${this.lines(org, c)}) SELECT count(*)::int AS count,count(*) FILTER (WHERE received>="orderedQuantity")::int AS complete FROM lines`,
        );
        const suppliers = await tx.$queryRaw<
          { supplierId: string; name: string; amount: Prisma.Decimal; ordersCount: number }[]
        >(Prisma.sql`
        SELECT o."supplierId",s.name,SUM(o.total) AS amount,count(*)::int AS "ordersCount" FROM ${s}."PurchaseOrder" o
        JOIN ${s}."Supplier" s ON s.id=o."supplierId" AND s."organizationId"=o."organizationId"
        WHERE ${this.scope(org, c)} GROUP BY o."supplierId",s.name ORDER BY amount DESC,o."supplierId" LIMIT ${q.limit}`);
        const receiptTrend = await tx.$queryRaw<{ bucket: string; count: number }[]>(Prisma.sql`
        WITH calendar AS (${buckets(c)}), receipts AS (
          SELECT ${bucket(Prisma.sql`r."receivedAt"`, c)} AS bucket,count(*)::int AS count FROM ${s}."GoodsReceipt" r
          JOIN ${s}."PurchaseOrder" o ON o.id=r."purchaseOrderId" AND o."organizationId"=r."organizationId"
          WHERE r."organizationId"=${org}::uuid ${timestampRange(Prisma.sql`r."receivedAt"`, c, c.timezone)} ${location(Prisma.sql`o."destinationLocationId"`, c.locationId)} GROUP BY bucket
        ) SELECT to_char(calendar.bucket,'YYYY-MM-DD') AS bucket,COALESCE(r.count,0) AS count FROM calendar LEFT JOIN receipts r USING(bucket) ORDER BY calendar.bucket`);
        return {
          context: c,
          currencyCode,
          orderedAmount: comparison(amount(cur?.amount ?? null), amount(prev?.amount ?? null)),
          purchaseOrdersCount: cur?.count ?? 0,
          openOrders: cur?.open ?? 0,
          partiallyReceivedOrders: cur?.partial ?? 0,
          fullyReceivedOrders: cur?.complete ?? 0,
          goodsReceiptsCount: receiptTrend.reduce((n, r) => n + r.count, 0),
          linesCount: lineCounts!.count,
          fullyReceivedLines: lineCounts!.complete,
          receivingProgressPercentage: lineCounts!.count
            ? decimal(lineCounts!.complete).div(lineCounts!.count).mul(100).toFixed(2)
            : null,
          topSuppliers: suppliers.map((r) => ({ ...r, amount: amount(r.amount) })),
          receiptTrend,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async receiving(org: string, q: AnalyticsQueryDto): Promise<ReceivingLine[]> {
    return this.prisma.$transaction(async (tx) => {
      const c = await analyticsContext(tx, org, q);
      const rows = await tx.$queryRaw<
        {
          id: string;
          purchaseOrderId: string;
          sequenceNumber: number;
          snapshotItemName: string;
          snapshotUnit: string;
          orderedQuantity: Prisma.Decimal;
          received: Prisma.Decimal;
        }[]
      >(Prisma.sql`${this.lines(org, c)} ORDER BY o."orderedAt" DESC,i.id LIMIT ${q.limit}`);
      return rows.map((r) => ({
        id: r.id,
        purchaseOrderId: r.purchaseOrderId,
        orderNumber: `PO-${String(r.sequenceNumber).padStart(6, '0')}`,
        itemName: r.snapshotItemName,
        unit: r.snapshotUnit,
        orderedQuantity: r.orderedQuantity.toFixed(6),
        receivedQuantity: r.received.toFixed(6),
        remainingQuantity: decimal(r.orderedQuantity).minus(r.received).toFixed(6),
      }));
    });
  }
}
