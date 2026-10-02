import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
// Up to 19-digit price * 19-digit quantity, then 100 lines, without intermediate precision loss.
const Exact = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
export const decimal = (value: string | Prisma.Decimal | number) => new Exact(value);
const maximum = decimal('999999999999999.9999');
export function money(value: Prisma.Decimal) {
  const rounded = value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  if (!rounded.isFinite() || rounded.lt(0) || rounded.gt(maximum))
    throw new BadRequestException('Money exceeds numeric(19,4) range');
  return rounded;
}
export function calculate(
  lines: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; discountAmount: Prisma.Decimal }[],
) {
  let subtotal = decimal(0),
    discountTotal = decimal(0);
  const totals = lines.map((line) => {
    if (!line.quantity.gt(0)) throw new BadRequestException('Quantity must be positive');
    const gross = money(decimal(line.quantity).times(line.unitPrice));
    if (line.discountAmount.lt(0) || line.discountAmount.gt(gross))
      throw new BadRequestException('Discount exceeds gross line amount');
    subtotal = subtotal.plus(gross);
    discountTotal = discountTotal.plus(line.discountAmount);
    return money(gross.minus(line.discountAmount));
  });
  return {
    subtotal: money(subtotal),
    discountTotal: money(discountTotal),
    total: money(subtotal.minus(discountTotal)),
    lines: totals,
  };
}
