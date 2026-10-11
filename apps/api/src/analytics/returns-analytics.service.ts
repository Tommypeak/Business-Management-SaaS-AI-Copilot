import { Injectable } from '@nestjs/common';
import type { ReturnsAnalyticsSummary } from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dateRange, location, timestampRange } from '../finance/calculations.js';
import { inventoryConflict } from '../inventory/inventory-locks.js';
import { analyticsContext, amount, bucket, buckets } from './analytics-query.js';
import type { AnalyticsQueryDto } from './analytics.dto.js';
type EventRow = {
  bucket: string;
  count: number;
  credit: Prisma.Decimal;
  refund: Prisma.Decimal;
  currencyCode: string | null;
  currencyCount: number;
};
@Injectable()
export class ReturnsAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}
  summary(org: string, q: AnalyticsQueryDto, finance: boolean): Promise<ReturnsAnalyticsSummary> {
    const s = this.prisma.sqlSchema;
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q);
        const rows = await tx.$queryRaw<EventRow[]>(Prisma.sql`
        WITH calendar AS (${buckets(c)}),events AS (
          SELECT ${bucket(Prisma.sql`r."postedAt"`, c)} bucket,r."currencyCode",r."totalRefundableAmount" credit,0::numeric refund,1 n
          FROM ${s}."SalesReturn" r JOIN ${s}."SalesOrder" o ON o.id=r."salesOrderId" AND o."organizationId"=r."organizationId"
          WHERE r."organizationId"=${org}::uuid AND r.status='POSTED' ${timestampRange(Prisma.sql`r."postedAt"`, c, c.timezone)} ${location(Prisma.sql`o."locationId"`, c.locationId)}
          UNION ALL SELECT ${bucket(Prisma.sql`f."paymentDate"`, c, false)},f."currencyCode",0,f.amount,0
          FROM ${s}."CustomerRefund" f JOIN ${s}."SalesOrder" o ON o.id=f."salesOrderId" AND o."organizationId"=f."organizationId"
          WHERE f."organizationId"=${org}::uuid ${dateRange(Prisma.sql`f."paymentDate"`, c)} ${location(Prisma.sql`o."locationId"`, c.locationId)}
        ),meta AS (SELECT count(DISTINCT "currencyCode")::int n,min("currencyCode") currency FROM events),
        totals AS (SELECT bucket,sum(n)::int n,sum(credit) credit,sum(refund) refund FROM events GROUP BY bucket)
        SELECT to_char(calendar.bucket,'YYYY-MM-DD') bucket,COALESCE(t.n,0)::int count,COALESCE(t.credit,0) credit,COALESCE(t.refund,0) refund,
          meta.currency AS "currencyCode",meta.n AS "currencyCount"
        FROM calendar CROSS JOIN meta LEFT JOIN totals t USING(bucket) ORDER BY calendar.bucket
      `);
        const top = await tx.$queryRaw<
          {
            variantId: string;
            itemName: string;
            variantName: string | null;
            sku: string | null;
            unit: string;
            type: 'PRODUCT' | 'SERVICE' | 'UNKNOWN';
            quantity: Prisma.Decimal;
            credit: Prisma.Decimal;
          }[]
        >(Prisma.sql`
        WITH lines AS (
          SELECT i.*,source."variantId",r."postedAt" FROM ${s}."SalesReturnItem" i
          JOIN ${s}."SalesReturn" r ON r.id=i."salesReturnId" AND r."organizationId"=i."organizationId"
          JOIN ${s}."SalesOrderItem" source ON source.id=i."salesOrderItemId" AND source."organizationId"=i."organizationId"
          JOIN ${s}."SalesOrder" o ON o.id=r."salesOrderId" AND o."organizationId"=r."organizationId"
          WHERE r."organizationId"=${org}::uuid AND r.status='POSTED' ${timestampRange(Prisma.sql`r."postedAt"`, c, c.timezone)} ${location(Prisma.sql`o."locationId"`, c.locationId)}
        ),totals AS (SELECT "variantId","snapshotUnit",COALESCE("snapshotItemType"::text,'UNKNOWN') kind,sum(quantity) quantity,sum("refundAmount") credit
          FROM lines GROUP BY "variantId","snapshotUnit",COALESCE("snapshotItemType"::text,'UNKNOWN')),
        snapshots AS (SELECT DISTINCT ON ("variantId","snapshotUnit",COALESCE("snapshotItemType"::text,'UNKNOWN'))
          "variantId","snapshotUnit",COALESCE("snapshotItemType"::text,'UNKNOWN') kind,"snapshotItemName","snapshotVariantName","snapshotSku"
          FROM lines ORDER BY "variantId","snapshotUnit",COALESCE("snapshotItemType"::text,'UNKNOWN'),"postedAt" DESC,id DESC)
        SELECT t."variantId",s."snapshotItemName" AS "itemName",s."snapshotVariantName" AS "variantName",s."snapshotSku" sku,
          t."snapshotUnit"::text unit,t.kind type,t.quantity,t.credit FROM totals t JOIN snapshots s USING("variantId","snapshotUnit",kind)
        ORDER BY t.quantity DESC,t."variantId",t."snapshotUnit",t.kind LIMIT ${q.limit}
      `);
        if (finance && rows[0]!.currencyCount > 1) inventoryConflict('FINANCE_MIXED_CURRENCY');
        return {
          context: c,
          financeVisible: finance,
          currencyCode: finance ? (rows[0]!.currencyCode ?? c.defaultCurrency) : null,
          returnsCount: rows.reduce((n, r) => n + r.count, 0),
          postedReturnCredits: finance
            ? rows.reduce((n, r) => n.plus(r.credit), new Prisma.Decimal(0)).toFixed(4)
            : null,
          customerRefundsPaid: finance
            ? rows.reduce((n, r) => n.plus(r.refund), new Prisma.Decimal(0)).toFixed(4)
            : null,
          topReturnedVariants: top.map((r) => ({
            variantId: r.variantId,
            itemName: r.itemName,
            variantName: r.variantName,
            sku: r.sku,
            unit: r.unit,
            type: r.type,
            quantityReturned: r.quantity.toFixed(6),
            returnCredits: finance ? amount(r.credit) : null,
          })),
          trend: rows.map((r) => ({
            bucket: r.bucket,
            returnsCount: r.count,
            postedReturnCredits: finance ? amount(r.credit) : null,
            customerRefundsPaid: finance ? amount(r.refund) : null,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
