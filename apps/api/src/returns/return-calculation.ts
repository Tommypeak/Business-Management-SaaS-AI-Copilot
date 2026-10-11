import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission, type PermissionCode } from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { inventoryConflict, type InventoryTx } from '../inventory/inventory-locks.js';
import { lockedOrder } from '../sales/sales-transaction.js';
import { decimal } from '../sales/totals.js';
import type { ReturnItemDto } from './returns.dto.js';
export async function requireReturnPermission(
  tx: InventoryTx,
  org: string,
  actor: string,
  permission: PermissionCode,
) {
  const member = await tx.organizationMembership.findFirst({
    where: { organizationId: org, userId: actor, status: 'ACTIVE' },
    include: {
      roles: {
        where: { organizationId: org },
        include: { role: { include: { permissions: { where: { organizationId: org } } } } },
      },
    },
  });
  if (!member) throw new NotFoundException();
  const permissions = member.roles.flatMap(({ role }) =>
    role.permissions.map((p) => p.permissionCode),
  );
  if (!permissions.includes(permission)) throw new ForbiddenException();
  return permissions.includes(Permission.FINANCE_VIEW);
}
export async function returnOrder(tx: InventoryTx, org: string, id: string, schema: Prisma.Sql) {
  await lockedOrder(tx, org, id);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM ${schema}."SalesOrder" WHERE id=${id}::uuid AND "organizationId"=${org}::uuid FOR UPDATE`,
  );
  const order = await tx.salesOrder.findFirstOrThrow({
    where: { id, organizationId: org },
    include: { items: { take: 100 } },
  });
  if (order.status !== 'COMPLETED') inventoryConflict('RETURN_REQUIRES_COMPLETED_SALE');
  return order;
}
export async function position(
  tx: InventoryTx,
  org: string,
  orderId: string,
  total: Prisma.Decimal,
) {
  const paid = await tx.salesPayment.aggregate({
    where: { organizationId: org, salesOrderId: orderId },
    _sum: { amount: true },
  });
  const credit = await tx.salesReturn.aggregate({
    where: { organizationId: org, salesOrderId: orderId, status: 'POSTED' },
    _sum: { totalRefundableAmount: true },
    _count: true,
  });
  const refund = await tx.customerRefund.aggregate({
    where: { organizationId: org, salesOrderId: orderId },
    _sum: { amount: true },
  });
  const p = decimal(paid._sum.amount ?? 0),
    c = decimal(credit._sum.totalRefundableAmount ?? 0),
    f = decimal(refund._sum.amount ?? 0);
  const cash = p.minus(f),
    unused = c.minus(f);
  return {
    p,
    c,
    f,
    count: credit._count,
    cash,
    unused,
    available: decimal(Prisma.Decimal.min(cash, unused)),
    adjusted: decimal(total).minus(c),
    netPaid: p.minus(f),
    outstanding: decimal(Prisma.Decimal.max(decimal(total).minus(c).minus(p).plus(f), 0)),
  };
}
export async function returnedLines(tx: InventoryTx, org: string, orderId: string) {
  const rows = await tx.salesReturnItem.groupBy({
    by: ['salesOrderItemId'],
    where: { organizationId: org, salesOrderId: orderId, salesReturn: { status: 'POSTED' } },
    _sum: { quantity: true, refundAmount: true },
  });
  return new Map(
    rows.map((r) => [
      r.salesOrderItemId,
      { quantity: decimal(r._sum.quantity ?? 0), credit: decimal(r._sum.refundAmount ?? 0) },
    ]),
  );
}
export async function quote(
  tx: InventoryTx,
  org: string,
  order: Awaited<ReturnType<typeof returnOrder>>,
  inputs: ReturnItemDto[],
) {
  const prior = await returnedLines(tx, org, order.id);
  const lines = inputs.map((input) => {
    const source = order.items.find((i) => i.id === input.salesOrderItemId);
    if (!source) throw new NotFoundException();
    const q = decimal(input.quantity);
    if (!q.isFinite() || !q.gt(0) || q.gt('9999999999999.999999'))
      throw new BadRequestException('Invalid return quantity');
    const old = prior.get(source.id) ?? { quantity: decimal(0), credit: decimal(0) };
    if (old.quantity.plus(q).gt(source.quantity)) inventoryConflict('RETURN_QUANTITY_EXCEEDED');
    if (input.restockDisposition === 'RESTOCK' && source.snapshotItemType !== 'PRODUCT')
      inventoryConflict('RESTOCK_NOT_ALLOWED');
    if (input.restockDisposition === 'NO_RESTOCK' && input.locationId)
      throw new BadRequestException('NO_RESTOCK cannot have a destination');
    if (input.restockDisposition === 'RESTOCK' && source.stockDeducted && !input.locationId)
      throw new BadRequestException('Restock destination required');
    const credit = decimal(source.lineTotal)
      .mul(old.quantity.plus(q))
      .div(source.quantity)
      .toDecimalPlaces(4)
      .minus(old.credit);
    return {
      source,
      input,
      quantity: q,
      credit,
      restocked:
        input.restockDisposition === 'RESTOCK' &&
        source.stockDeducted &&
        source.snapshotItemType === 'PRODUCT',
    };
  });
  return { lines, total: lines.reduce((sum, l) => sum.plus(l.credit), decimal(0)) };
}
