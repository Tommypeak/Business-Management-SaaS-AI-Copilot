import { Injectable } from '@nestjs/common';
import type { CashFlowTrendResponse, FinanceAnalyticsSummary } from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FinanceService } from '../finance/finance.service.js';
import {
  dateRange,
  timestampRange,
  location,
  netCashFlow,
  singleCurrency,
} from '../finance/calculations.js';
import { inventoryConflict } from '../inventory/inventory-locks.js';
import { decimal } from '../sales/totals.js';
import { analyticsContext, amount, comparison, bucket, buckets } from './analytics-query.js';
import type { AnalyticsQueryDto } from './analytics.dto.js';
@Injectable()
export class FinanceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}
  async summary(org: string, q: AnalyticsQueryDto): Promise<FinanceAnalyticsSummary> {
    const c = await this.prisma.$transaction((tx) => analyticsContext(tx, org, q));
    const current = await this.finance.summaryWithCurrencies(org, c);
    const prior = await this.finance.summaryWithCurrencies(org, { ...c, ...c.previous });
    const currencyCode = singleCurrency(
      [...current.currencies, ...prior.currencies].map((currencyCode) => ({ currencyCode })),
      c.defaultCurrency,
    );
    const summary = { ...current.summary, currencyCode },
      previous = prior.summary;
    const expensesByCategory = await this.finance.expensesByCategory(org, c, 50);
    return {
      context: c,
      summary,
      expensesByCategory,
      comparisons: {
        sales: comparison(summary.salesAmount, previous.salesAmount),
        payments: comparison(summary.paymentsCollected, previous.paymentsCollected),
        expenses: comparison(summary.expensesPaid, previous.expensesPaid),
        supplierPayments:
          summary.supplierPaymentsPaid === null
            ? null
            : comparison(summary.supplierPaymentsPaid, previous.supplierPaymentsPaid ?? '0'),
        netCashFlow: comparison(summary.netCashFlow, previous.netCashFlow),
      },
    };
  }
  async cashFlow(org: string, q: AnalyticsQueryDto): Promise<CashFlowTrendResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await analyticsContext(tx, org, q),
          s = this.prisma.sqlSchema;
        const rows = await tx.$queryRaw<
          {
            bucket: string;
            currencyCode: string | null;
            currencyCount: number;
            customerPayments: Prisma.Decimal;
            operatingExpenses: Prisma.Decimal;
            supplierPayments: Prisma.Decimal;
          }[]
        >(Prisma.sql`
        WITH calendar AS (${buckets(c)}), events AS (
          SELECT ${bucket(Prisma.sql`p."createdAt"`, c)} AS bucket,o."currencyCode",p.amount,'customer' AS kind
          FROM ${s}."SalesPayment" p JOIN ${s}."SalesOrder" o ON o.id=p."salesOrderId" AND o."organizationId"=p."organizationId"
          WHERE p."organizationId"=${org}::uuid ${timestampRange(Prisma.sql`p."createdAt"`, c, c.timezone)} ${location(Prisma.sql`o."locationId"`, c.locationId)}
          UNION ALL
          SELECT ${bucket(Prisma.sql`e."expenseDate"`, c, false)},e."currencyCode",e.amount,'expense'
          FROM ${s}."Expense" e WHERE e."organizationId"=${org}::uuid AND e.status='POSTED'
          ${dateRange(Prisma.sql`e."expenseDate"`, c)} ${location(Prisma.sql`e."locationId"`, c.locationId)}
          ${
            c.locationId
              ? Prisma.empty
              : Prisma.sql`UNION ALL SELECT ${bucket(Prisma.sql`p."paymentDate"`, c, false)},b."currencyCode",p.amount,'supplier'
            FROM ${s}."SupplierPayment" p JOIN ${s}."SupplierBill" b ON b.id=p."supplierBillId" AND b."organizationId"=p."organizationId"
            WHERE p."organizationId"=${org}::uuid ${dateRange(Prisma.sql`p."paymentDate"`, c)}`
          }
        ), meta AS (SELECT count(DISTINCT "currencyCode")::int AS count,min("currencyCode") AS currency FROM events), totals AS (
          SELECT bucket,COALESCE(SUM(amount) FILTER(WHERE kind='customer'),0) AS customer,
            COALESCE(SUM(amount) FILTER(WHERE kind='expense'),0) AS expense,COALESCE(SUM(amount) FILTER(WHERE kind='supplier'),0) AS supplier FROM events GROUP BY bucket
        ) SELECT to_char(calendar.bucket,'YYYY-MM-DD') AS bucket,meta.currency AS "currencyCode",meta.count AS "currencyCount",
          COALESCE(t.customer,0) AS "customerPayments",COALESCE(t.expense,0) AS "operatingExpenses",COALESCE(t.supplier,0) AS "supplierPayments"
          FROM calendar CROSS JOIN meta LEFT JOIN totals t USING(bucket) ORDER BY calendar.bucket`);
        if (rows[0]!.currencyCount > 1) inventoryConflict('FINANCE_MIXED_CURRENCY');
        return {
          context: c,
          currencyCode: rows[0]!.currencyCode ?? c.defaultCurrency,
          supplierPaymentsLocationScoped: !c.locationId,
          points: rows.map((r) => ({
            bucket: r.bucket,
            customerPayments: amount(r.customerPayments),
            operatingExpenses: amount(r.operatingExpenses),
            supplierPayments: c.locationId ? null : amount(r.supplierPayments),
            netCashFlow: netCashFlow(
              decimal(r.customerPayments),
              decimal(r.operatingExpenses),
              decimal(r.supplierPayments),
            ).toFixed(4),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
