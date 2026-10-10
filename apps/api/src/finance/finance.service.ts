import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ExpenseCategoryBreakdownResponse, FinanceSummaryResponse } from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type InventoryTx } from '../inventory/inventory-locks.js';
import { decimal } from '../sales/totals.js';
import type { FinanceQueryDto } from '../expenses/expenses.dto.js';

import {
  timestampRange,
  dateRange,
  location,
  singleCurrency,
  sum,
  netCashFlow,
} from './calculations.js';

type MoneyRow = { currencyCode: string; amount: Prisma.Decimal };
type CategoryRow = {
  categoryId: string;
  categoryName: string;
  currencyCode: string;
  amount: Prisma.Decimal;
  count: number;
};

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private async context(tx: InventoryTx, org: string, query: FinanceQueryDto) {
    if (query.from && query.to && query.from > query.to)
      throw new BadRequestException('from must not exceed to');
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: org },
      select: { defaultCurrency: true, timezone: true },
    });
    if (query.locationId) {
      const found = await tx.location.findFirst({
        where: { organizationId: org, id: query.locationId },
        select: { id: true },
      });
      if (!found) throw new NotFoundException();
    }
    return organization;
  }

  async summary(org: string, query: FinanceQueryDto): Promise<FinanceSummaryResponse> {
    return (await this.summaryWithCurrencies(org, query)).summary;
  }

  // Preserve source currencies even when their numeric sum is zero. Analytics uses
  // this metadata to compare empty periods without treating the fallback as money.
  async summaryWithCurrencies(org: string, query: FinanceQueryDto) {
    const schema = this.prisma.sqlSchema;
    return this.prisma.$transaction(
      async (tx) => {
        const organization = await this.context(tx, org, query);
        const sales = await tx.$queryRaw<MoneyRow[]>(Prisma.sql`
          SELECT so."currencyCode", SUM(so.total) AS amount
          FROM ${schema}."SalesOrder" so
          WHERE so."organizationId" = ${org}::uuid AND so.status = 'COMPLETED'
          ${timestampRange(Prisma.sql`so."completedAt"`, query, organization.timezone)}
          ${location(Prisma.sql`so."locationId"`, query.locationId)}
          GROUP BY so."currencyCode"
        `);
        const payments = await tx.$queryRaw<MoneyRow[]>(Prisma.sql`
          SELECT so."currencyCode", SUM(p.amount) AS amount
          FROM ${schema}."SalesPayment" p JOIN ${schema}."SalesOrder" so
            ON so.id = p."salesOrderId" AND so."organizationId" = p."organizationId"
          WHERE p."organizationId" = ${org}::uuid
          ${timestampRange(Prisma.sql`p."createdAt"`, query, organization.timezone)}
          ${location(Prisma.sql`so."locationId"`, query.locationId)}
          GROUP BY so."currencyCode"
        `);
        const expenses = await tx.$queryRaw<MoneyRow[]>(Prisma.sql`
          SELECT e."currencyCode", SUM(e.amount) AS amount
          FROM ${schema}."Expense" e
          WHERE e."organizationId" = ${org}::uuid AND e.status = 'POSTED'
          ${dateRange(Prisma.sql`e."expenseDate"`, query)}
          ${location(Prisma.sql`e."locationId"`, query.locationId)}
          GROUP BY e."currencyCode"
        `);
        const outstanding = await tx.$queryRaw<MoneyRow[]>(Prisma.sql`
          SELECT so."currencyCode",
            SUM(GREATEST(so.total - COALESCE(p.paid, 0), 0)) AS amount
          FROM ${schema}."SalesOrder" so
          LEFT JOIN (
            SELECT "salesOrderId", SUM(amount) AS paid
            FROM ${schema}."SalesPayment" WHERE "organizationId" = ${org}::uuid
            GROUP BY "salesOrderId"
          ) p ON p."salesOrderId" = so.id
          WHERE so."organizationId" = ${org}::uuid AND so.status = 'COMPLETED'
          ${location(Prisma.sql`so."locationId"`, query.locationId)}
          GROUP BY so."currencyCode"
        `);
        const supplierPayments = query.locationId
          ? []
          : await tx.$queryRaw<MoneyRow[]>(Prisma.sql`
              SELECT b."currencyCode", SUM(p.amount) AS amount
              FROM ${schema}."SupplierPayment" p JOIN ${schema}."SupplierBill" b
                ON b.id = p."supplierBillId" AND b."organizationId" = p."organizationId"
              WHERE p."organizationId" = ${org}::uuid
              ${dateRange(Prisma.sql`p."paymentDate"`, query)}
              GROUP BY b."currencyCode"
            `);
        const payables = query.locationId
          ? []
          : await tx.$queryRaw<MoneyRow[]>(Prisma.sql`
              SELECT b."currencyCode", SUM(GREATEST(b.amount - COALESCE(p.paid, 0), 0)) AS amount
              FROM ${schema}."SupplierBill" b LEFT JOIN (
                SELECT "supplierBillId", SUM(amount) AS paid FROM ${schema}."SupplierPayment"
                WHERE "organizationId" = ${org}::uuid GROUP BY "supplierBillId"
              ) p ON p."supplierBillId" = b.id
              WHERE b."organizationId" = ${org}::uuid AND b.status = 'POSTED'
              GROUP BY b."currencyCode"
            `);
        const sourceRows = [
          ...sales,
          ...payments,
          ...expenses,
          ...outstanding,
          ...supplierPayments,
          ...payables,
        ];
        const currencyCode = singleCurrency(sourceRows, organization.defaultCurrency);
        const collected = sum(payments),
          paid = sum(expenses),
          supplierPaid = sum(supplierPayments);
        const summary: FinanceSummaryResponse = {
          currencyCode,
          timezone: organization.timezone,
          from: query.from ?? null,
          to: query.to ?? null,
          salesAmount: sum(sales).toFixed(4),
          paymentsCollected: collected.toFixed(4),
          expensesPaid: paid.toFixed(4),
          supplierPaymentsPaid: query.locationId ? null : supplierPaid.toFixed(4),
          supplierPaymentsLocationScoped: !query.locationId,
          netCashFlow: netCashFlow(collected, paid, supplierPaid).toFixed(4),
          outstandingReceivablesCurrent: sum(outstanding).toFixed(4),
          outstandingPayablesCurrent: query.locationId ? null : sum(payables).toFixed(4),
        };
        return { summary, currencies: [...new Set(sourceRows.map((row) => row.currencyCode))] };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async expensesByCategory(
    org: string,
    query: FinanceQueryDto,
    limit?: number,
  ): Promise<ExpenseCategoryBreakdownResponse[]> {
    const schema = this.prisma.sqlSchema;
    return this.prisma.$transaction(
      async (tx) => {
        const organization = await this.context(tx, org, query);
        const rows = await tx.$queryRaw<CategoryRow[]>(Prisma.sql`
          SELECT e."categoryId", c.name AS "categoryName", e."currencyCode",
            SUM(e.amount) AS amount, count(*)::int AS count
          FROM ${schema}."Expense" e JOIN ${schema}."ExpenseCategory" c
            ON c.id = e."categoryId" AND c."organizationId" = e."organizationId"
          WHERE e."organizationId" = ${org}::uuid AND e.status = 'POSTED'
          ${dateRange(Prisma.sql`e."expenseDate"`, query)}
          ${location(Prisma.sql`e."locationId"`, query.locationId)}
          GROUP BY e."categoryId", c.name, e."currencyCode"
          ORDER BY amount DESC, c.name ASC
          ${limit === undefined ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}
        `);
        singleCurrency(rows, organization.defaultCurrency);
        return rows.map((row) => ({
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          amount: decimal(row.amount).toFixed(4),
          count: row.count,
        }));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
