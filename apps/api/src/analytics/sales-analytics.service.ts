import { Injectable } from '@nestjs/common';
import type {
  SalesAnalyticsSummary,
  SalesTrendResponse,
  TopSellingVariant,
  AnalyticsContext,
} from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { timestampRange, location, singleCurrency } from '../finance/calculations.js';
import { decimal } from '../sales/totals.js';
import { analyticsContext, amount, comparison, bucket, buckets } from './analytics-query.js';
import type { AnalyticsQueryDto } from './analytics.dto.js';
type Total = { currencyCode: string; amount: Prisma.Decimal; count: number; period: string };

@Injectable()
export class SalesAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}
  private scope(org: string, c: AnalyticsContext) {
    return Prisma.sql`o."organizationId" = ${org}::uuid AND o.status = 'COMPLETED'
      ${timestampRange(Prisma.sql`o."completedAt"`, c, c.timezone)} ${location(Prisma.sql`o."locationId"`, c.locationId)}`;
  }
  private async totals(tx: Prisma.TransactionClient, org: string, c: AnalyticsContext) {
    return tx.$queryRaw<Total[]>(Prisma.sql`
      SELECT o."currencyCode", SUM(o.total) AS amount, count(*)::int AS count,
        CASE WHEN o."completedAt" >= (${c.from}::date::timestamp AT TIME ZONE ${c.timezone}) THEN 'current' ELSE 'previous' END AS period
      FROM ${this.prisma.sqlSchema}."SalesOrder" o WHERE ${this.scope(org, { ...c, from: c.previous.from })}
      GROUP BY o."currencyCode", period`);
  }
  async summary(org: string, q: AnalyticsQueryDto): Promise<SalesAnalyticsSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q),
          s = this.prisma.sqlSchema;
        const totals = await this.totals(tx, org, c);
        const currencyCode = singleCurrency(totals, c.defaultCurrency);
        const current = totals.find((row) => row.period === 'current'),
          previous = totals.find((row) => row.period === 'previous');
        const byLocation = await tx.$queryRaw<
          { locationId: string | null; name: string; amount: Prisma.Decimal; ordersCount: number }[]
        >(Prisma.sql`
        SELECT o."locationId", COALESCE(l.name, 'Unallocated') AS name, SUM(o.total) AS amount, count(*)::int AS "ordersCount"
        FROM ${s}."SalesOrder" o LEFT JOIN ${s}."Location" l ON l.id = o."locationId" AND l."organizationId" = o."organizationId"
        WHERE ${this.scope(org, c)} GROUP BY o."locationId", l.name ORDER BY amount DESC, o."locationId" LIMIT 50`);
        const byType = await tx.$queryRaw<
          { type: 'PRODUCT' | 'SERVICE' | 'UNKNOWN'; amount: Prisma.Decimal }[]
        >(Prisma.sql`
        SELECT COALESCE(i."snapshotItemType"::text, 'UNKNOWN') AS type, SUM(i."lineTotal") AS amount
        FROM ${s}."SalesOrderItem" i JOIN ${s}."SalesOrder" o ON o.id = i."salesOrderId" AND o."organizationId" = i."organizationId"
        WHERE ${this.scope(org, c)} GROUP BY i."snapshotItemType" ORDER BY type`);
        return {
          context: c,
          currencyCode,
          sales: comparison(amount(current?.amount ?? null), amount(previous?.amount ?? null)),
          orders: comparison(current?.count ?? 0, previous?.count ?? 0),
          averageOrderValue: current?.count
            ? decimal(current.amount).div(current.count).toFixed(4)
            : null,
          byLocation: byLocation.map((row) => ({ ...row, amount: amount(row.amount) })),
          byType: byType.map((row) => ({ ...row, amount: amount(row.amount) })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async trend(org: string, q: AnalyticsQueryDto): Promise<SalesTrendResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q);
        const currencyCode = singleCurrency(await this.totals(tx, org, c), c.defaultCurrency);
        const rows = await tx.$queryRaw<
          { bucket: string; salesAmount: Prisma.Decimal; ordersCount: number }[]
        >(Prisma.sql`
        WITH calendar AS (${buckets(c)}), totals AS (
          SELECT ${bucket(Prisma.sql`o."completedAt"`, c)} AS bucket, SUM(o.total) AS amount, count(*)::int AS count
          FROM ${this.prisma.sqlSchema}."SalesOrder" o WHERE ${this.scope(org, c)} GROUP BY bucket
        ) SELECT to_char(calendar.bucket, 'YYYY-MM-DD') AS bucket, COALESCE(t.amount,0) AS "salesAmount", COALESCE(t.count,0) AS "ordersCount"
        FROM calendar LEFT JOIN totals t USING (bucket) ORDER BY calendar.bucket`);
        return {
          context: c,
          currencyCode,
          points: rows.map((row) => ({ ...row, salesAmount: amount(row.salesAmount) })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async top(org: string, q: AnalyticsQueryDto): Promise<TopSellingVariant[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q),
          s = this.prisma.sqlSchema;
        const currencyCode = singleCurrency(await this.totals(tx, org, c), c.defaultCurrency);
        const rows = await tx.$queryRaw<
          (Omit<TopSellingVariant, 'quantitySold' | 'salesAmount' | 'currencyCode'> & {
            quantitySold: Prisma.Decimal;
            salesAmount: Prisma.Decimal;
          })[]
        >(Prisma.sql`
        SELECT i."variantId", i."snapshotUnit"::text AS unit, COALESCE(i."snapshotItemType"::text, 'UNKNOWN') AS type,
          (array_agg(i."snapshotItemName" ORDER BY o."completedAt" DESC, i.id DESC))[1] AS "itemName",
          (array_agg(i."snapshotVariantName" ORDER BY o."completedAt" DESC, i.id DESC))[1] AS "variantName",
          (array_agg(i."snapshotSku" ORDER BY o."completedAt" DESC, i.id DESC))[1] AS sku,
          SUM(i.quantity) AS "quantitySold", SUM(i."lineTotal") AS "salesAmount", count(DISTINCT o.id)::int AS "ordersCount"
        FROM ${s}."SalesOrderItem" i JOIN ${s}."SalesOrder" o ON o.id=i."salesOrderId" AND o."organizationId"=i."organizationId"
        WHERE ${this.scope(org, c)} ${q.itemType ? Prisma.sql`AND COALESCE(i."snapshotItemType"::text, 'UNKNOWN') = ${q.itemType}` : Prisma.empty}
        GROUP BY i."variantId", i."snapshotUnit", i."snapshotItemType" ORDER BY "salesAmount" DESC, i."variantId", unit, type LIMIT ${q.limit}`);
        return rows.map((row) => ({
          ...row,
          currencyCode,
          quantitySold: row.quantitySold.toFixed(6),
          salesAmount: amount(row.salesAmount),
        }));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
