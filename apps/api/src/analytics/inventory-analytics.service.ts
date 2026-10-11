import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  InventoryAnalyticsSummary,
  InventoryLocationSummary,
  InventoryMovementPoint,
  AnalyticsContext,
} from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { timestampRange, location } from '../finance/calculations.js';
import { analyticsContext, bucket } from './analytics-query.js';
import type { AnalyticsQueryDto } from './analytics.dto.js';

@Injectable()
export class InventoryAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}
  private movementScope(org: string, c: AnalyticsContext) {
    return Prisma.sql`e."organizationId"=${org}::uuid ${timestampRange(Prisma.sql`e."createdAt"`, c, c.timezone)} ${location(Prisma.sql`e."locationId"`, c.locationId)}`;
  }
  // Shared candidate definition for counts and bounded stock warnings.
  private candidates(org: string, locationId?: string) {
    const s = this.prisma.sqlSchema;
    return Prisma.sql`WITH balances AS (
      SELECT "variantId", SUM(quantity) AS quantity, bool_or(quantity <> 0) AS nonzero,
        count(*) FILTER (WHERE quantity < 0)::int AS negatives
      FROM ${s}."InventoryBalance" b WHERE b."organizationId"=${org}::uuid ${location(Prisma.sql`b."locationId"`, locationId)} GROUP BY "variantId"
    ), candidates AS (
      SELECT v.id, i.name, v.name AS "variantName", v.sku, v.unit::text AS unit,
        COALESCE(b.quantity,0) AS quantity, COALESCE(b.negatives,0) AS negatives,
        (v."isActive" AND i."isActive" AND i.type='PRODUCT' AND i."trackInventory") AS active
      FROM ${s}."CatalogVariant" v JOIN ${s}."CatalogItem" i ON i.id=v."catalogItemId" AND i."organizationId"=v."organizationId"
      LEFT JOIN balances b ON b."variantId"=v.id
      WHERE v."organizationId"=${org}::uuid AND ((v."isActive" AND i."isActive" AND i.type='PRODUCT' AND i."trackInventory") OR b.nonzero)
    )`;
  }
  async warnings(org: string, q: AnalyticsQueryDto) {
    const c = await analyticsContext(this.prisma, org, q);
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        variantName: string | null;
        sku: string | null;
        unit: string;
        quantity: Prisma.Decimal;
        negatives: number;
        active: boolean;
      }[]
    >(Prisma.sql`
      ${this.candidates(org, c.locationId)} SELECT * FROM candidates WHERE quantity<=0 OR negatives>0 ORDER BY quantity,id LIMIT 21`);
    return {
      items: rows.slice(0, 20).map((r) => ({ ...r, quantity: r.quantity.toFixed(6) })),
      truncated: rows.length > 20,
    };
  }
  async summary(org: string, q: AnalyticsQueryDto): Promise<InventoryAnalyticsSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q),
          s = this.prisma.sqlSchema;
        const [row] = await tx.$queryRaw<
          Omit<InventoryAnalyticsSummary, 'context' | 'topMovingVariants'>[]
        >(Prisma.sql`
        ${this.candidates(org, c.locationId)} SELECT count(*)::int AS "trackedVariants", count(*) FILTER (WHERE quantity=0)::int AS "zeroStock",
          count(*) FILTER (WHERE quantity<0)::int AS "negativeStock", COALESCE(sum(negatives),0)::int AS "negativeLocationBalances",
          count(*) FILTER (WHERE NOT active)::int AS "archivedNonZeroVariants" FROM candidates`);
        const top = await tx.$queryRaw<
          {
            variantId: string;
            name: string;
            unit: string;
            movementCount: number;
            inbound: Prisma.Decimal;
            outbound: Prisma.Decimal;
          }[]
        >(Prisma.sql`
        SELECT e."variantId", i.name, v.unit::text AS unit, count(*)::int AS "movementCount",
          COALESCE(SUM(e."quantityDelta") FILTER (WHERE e."quantityDelta">0),0) AS inbound,
          COALESCE(-SUM(e."quantityDelta") FILTER (WHERE e."quantityDelta"<0),0) AS outbound
        FROM ${s}."InventoryLedgerEntry" e JOIN ${s}."CatalogVariant" v ON v.id=e."variantId" AND v."organizationId"=e."organizationId"
        JOIN ${s}."CatalogItem" i ON i.id=v."catalogItemId" AND i."organizationId"=v."organizationId"
        WHERE ${this.movementScope(org, c)} GROUP BY e."variantId", i.name, v.unit ORDER BY "movementCount" DESC, e."variantId" LIMIT ${q.limit}`);
        return {
          context: c,
          ...row!,
          topMovingVariants: top.map((r) => ({
            ...r,
            inbound: r.inbound.toFixed(6),
            outbound: r.outbound.toFixed(6),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async movements(
    org: string,
    q: AnalyticsQueryDto,
  ): Promise<{ context: AnalyticsContext; points: InventoryMovementPoint[] }> {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q),
          s = this.prisma.sqlSchema;
        const rows = await tx.$queryRaw<
          {
            bucket: string;
            unit: string;
            type: string;
            inbound: Prisma.Decimal;
            outbound: Prisma.Decimal;
            net: Prisma.Decimal;
            entriesCount: number;
          }[]
        >(Prisma.sql`
        SELECT to_char(${bucket(Prisma.sql`e."createdAt"`, c)}, 'YYYY-MM-DD') AS bucket, v.unit::text AS unit, t.type::text AS type,
          COALESCE(SUM(e."quantityDelta") FILTER (WHERE e."quantityDelta">0),0) AS inbound,
          COALESCE(-SUM(e."quantityDelta") FILTER (WHERE e."quantityDelta"<0),0) AS outbound,
          SUM(e."quantityDelta") AS net, count(*)::int AS "entriesCount"
        FROM ${s}."InventoryLedgerEntry" e JOIN ${s}."InventoryTransaction" t ON t.id=e."transactionId" AND t."organizationId"=e."organizationId"
        JOIN ${s}."CatalogVariant" v ON v.id=e."variantId" AND v."organizationId"=e."organizationId"
        WHERE ${this.movementScope(org, c)} GROUP BY bucket, v.unit, t.type ORDER BY bucket, unit, type LIMIT 5001`);
        if (rows.length > 5000)
          throw new BadRequestException('Choose weekly or monthly inventory aggregation');
        return {
          context: c,
          points: rows.map((r) => ({
            ...r,
            inbound: r.inbound.toFixed(6),
            outbound: r.outbound.toFixed(6),
            net: r.net.toFixed(6),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async locations(org: string, q: AnalyticsQueryDto): Promise<InventoryLocationSummary[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q),
          s = this.prisma.sqlSchema;
        return tx.$queryRaw<InventoryLocationSummary[]>(Prisma.sql`
        WITH active AS (
          SELECT v.id FROM ${s}."CatalogVariant" v JOIN ${s}."CatalogItem" i ON i.id=v."catalogItemId" AND i."organizationId"=v."organizationId"
          WHERE v."organizationId"=${org}::uuid AND v."isActive" AND i."isActive" AND i.type='PRODUCT' AND i."trackInventory"
        ), stock AS (
          SELECT b."locationId", count(*) FILTER (WHERE b.quantity<>0 AND a.id IS NULL)::int AS archived,
            count(*) FILTER (WHERE b.quantity<>0 AND a.id IS NOT NULL)::int AS active_nonzero,
            count(*) FILTER (WHERE b.quantity<0)::int AS negatives
          FROM ${s}."InventoryBalance" b LEFT JOIN active a ON a.id=b."variantId"
          WHERE b."organizationId"=${org}::uuid GROUP BY b."locationId"
        ), movements AS (
          SELECT e."locationId", count(*)::int AS count FROM ${s}."InventoryLedgerEntry" e
          WHERE ${this.movementScope(org, c)} GROUP BY e."locationId"
        ) SELECT l.id AS "locationId", l.name, l."isActive",
          ((SELECT count(*) FROM active)+COALESCE(s.archived,0))::int AS "trackedVariants",
          ((SELECT count(*) FROM active)-COALESCE(s.active_nonzero,0))::int AS "zeroStock",
          COALESCE(s.negatives,0) AS "negativeStock", COALESCE(m.count,0) AS "movementCount"
        FROM ${s}."Location" l LEFT JOIN stock s ON s."locationId"=l.id LEFT JOIN movements m ON m."locationId"=l.id
        WHERE l."organizationId"=${org}::uuid ${location(Prisma.sql`l.id`, c.locationId)} ORDER BY l.name,l.id LIMIT 50`);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
