import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AnalyticsContext, KpiComparison } from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { decimal } from '../sales/totals.js';
import type { AnalyticsQueryDto } from './analytics.dto.js';

export const amount = (value: Prisma.Decimal | string | number | null) =>
  decimal(value ?? 0).toFixed(4);
export function comparison(current: string | number, previous: string | number): KpiComparison {
  const c = decimal(current),
    p = decimal(previous),
    delta = c.minus(p);
  return {
    currentValue: c.toFixed(4),
    previousValue: p.toFixed(4),
    absoluteChange: delta.toFixed(4),
    percentageChange: p.eq(0) ? null : delta.div(p.abs()).mul(100).toFixed(2),
  };
}
export async function analyticsContext(
  tx: Prisma.TransactionClient,
  org: string,
  q: AnalyticsQueryDto,
): Promise<AnalyticsContext & { defaultCurrency: string }> {
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: org },
    select: { timezone: true, defaultCurrency: true },
  });
  if (!!q.from !== !!q.to) throw new BadRequestException('Provide both from and to');
  if (
    q.locationId &&
    !(await tx.location.findFirst({
      where: { organizationId: org, id: q.locationId },
      select: { id: true },
    }))
  )
    throw new NotFoundException();
  const [dates] = await tx.$queryRaw<{ today: string }[]>(
    Prisma.sql`SELECT to_char(now() AT TIME ZONE ${organization.timezone}, 'YYYY-MM-DD') AS today`,
  );
  const to = q.to ?? dates!.today;
  const shift = (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const from = q.from ?? shift(to, -29);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (days < 1 || days > 366 || from < '1900-01-01' || to > '9998-12-31')
    throw new BadRequestException('Select 1 to 366 calendar days between 1900 and 9998');
  return {
    ...organization,
    from,
    to,
    previous: { from: shift(from, -days), to: shift(from, -1) },
    locationId: q.locationId,
    granularity: q.granularity,
  };
}
export function bucket(column: Prisma.Sql, c: AnalyticsContext, timestamp = true) {
  const local = timestamp ? Prisma.sql`(${column} AT TIME ZONE ${c.timezone})` : column;
  return Prisma.sql`date_trunc(${c.granularity.toLowerCase()}, ${local})::date`;
}
export function buckets(c: AnalyticsContext) {
  const interval =
    c.granularity === 'DAY' ? '1 day' : c.granularity === 'WEEK' ? '1 week' : '1 month';
  return Prisma.sql`SELECT d::date AS bucket FROM generate_series(date_trunc(${c.granularity.toLowerCase()}, ${c.from}::date::timestamp), date_trunc(${c.granularity.toLowerCase()}, ${c.to}::date::timestamp), ${interval}::interval) d`;
}
