import { Prisma } from '../generated/prisma/client.js';
import { decimal } from '../sales/totals.js';
import { inventoryConflict } from '../inventory/inventory-locks.js';
import type { FinanceQueryDto } from '../expenses/expenses.dto.js';
type MoneyRow = { currencyCode: string; amount: Prisma.Decimal };
export function timestampRange(column: Prisma.Sql, query: FinanceQueryDto, timezone: string) {
  const filters: Prisma.Sql[] = [];
  if (query.from)
    filters.push(
      Prisma.sql`${column} >= (${query.from}::date::timestamp AT TIME ZONE ${timezone})`,
    );
  if (query.to)
    filters.push(
      Prisma.sql`${column} < (((${query.to}::date + 1)::timestamp) AT TIME ZONE ${timezone})`,
    );
  return filters.length ? Prisma.sql` AND ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
}
export function dateRange(column: Prisma.Sql, query: FinanceQueryDto) {
  const filters: Prisma.Sql[] = [];
  if (query.from) filters.push(Prisma.sql`${column} >= ${query.from}::date`);
  if (query.to) filters.push(Prisma.sql`${column} <= ${query.to}::date`);
  return filters.length ? Prisma.sql` AND ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
}
export const location = (column: Prisma.Sql, id?: string) =>
  id ? Prisma.sql` AND ${column} = ${id}::uuid` : Prisma.empty;
export function singleCurrency(rows: { currencyCode: string }[], fallback: string) {
  const currencies = new Set(rows.map((row) => row.currencyCode));
  if (currencies.size > 1) inventoryConflict('FINANCE_MIXED_CURRENCY');
  return currencies.values().next().value ?? fallback;
}
export function sum(rows: MoneyRow[]) {
  return rows.reduce((result, row) => result.plus(row.amount), decimal(0));
}

export const netCashFlow = (
  collected: Prisma.Decimal,
  expenses: Prisma.Decimal,
  suppliers: Prisma.Decimal,
) => collected.minus(expenses).minus(suppliers);
