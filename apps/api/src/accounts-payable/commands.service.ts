import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  inventoryConflict,
  inventoryLock,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import { runSalesTransaction } from '../sales/sales-transaction.js';
import { cleanText, requestHash } from '../sales/payments.service.js';
import { decimal, money } from '../sales/totals.js';
import { activeSupplier } from '../purchasing/suppliers.service.js';
import { AccountsPayableQueryService } from './query.service.js';
import type {
  CreateSupplierBillDto,
  CreateSupplierPaymentDto,
  UpdateSupplierBillDto,
  VoidSupplierBillDto,
} from './accounts-payable.dto.js';

const businessDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const billKey = (org: string, id: string) => `accounts-payable:bill:${org}:${id}`;
const commandKey = (org: string, kind: string, key: string) =>
  `accounts-payable:${kind}-key:${org}:${key}`;
function positiveAmount(value: string) {
  const result = money(decimal(value));
  if (!result.gt(0)) throw new BadRequestException('Amount must be positive');
  return result.toFixed(4);
}
function invoice(value: string | null | undefined) {
  const display = cleanText(value)?.replace(/\s+/gu, ' ') ?? null;
  return {
    supplierInvoiceNumber: display,
    normalizedInvoiceNumber: display?.normalize('NFKC').toLowerCase() ?? null,
  };
}
function normalized(input: CreateSupplierBillDto) {
  if (input.dueDate && input.dueDate < input.issueDate)
    throw new BadRequestException('dueDate must not precede issueDate');
  return {
    supplierId: input.supplierId,
    purchaseOrderId: input.purchaseOrderId ?? null,
    ...invoice(input.supplierInvoiceNumber),
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    amount: positiveAmount(input.amount),
    description: cleanText(input.description),
    note: cleanText(input.note),
  };
}
async function lockedBill(tx: InventoryTx, org: string, id: string) {
  await inventoryLock(tx, billKey(org, id));
  const row = await tx.supplierBill.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new NotFoundException();
  return row;
}
async function validReferences(
  tx: InventoryTx,
  org: string,
  supplierId: string,
  purchaseOrderId: string | null,
  currencyCode?: string,
  posting = false,
) {
  let purchaseOrder: Awaited<ReturnType<typeof tx.purchaseOrder.findFirst>> = null;
  // Purchasing commands acquire the PO gate before the Supplier gate.
  if (purchaseOrderId) {
    await inventoryLock(tx, `purchasing:order:${org}:${purchaseOrderId}`, true);
    purchaseOrder = await tx.purchaseOrder.findFirst({
      where: { organizationId: org, id: purchaseOrderId },
    });
    if (!purchaseOrder) throw new NotFoundException();
    if (purchaseOrder.supplierId !== supplierId)
      inventoryConflict('BILL_PURCHASE_ORDER_SUPPLIER_MISMATCH');
    if (purchaseOrder.status === 'CANCELLED' || (posting && purchaseOrder.status === 'DRAFT'))
      inventoryConflict('BILL_PURCHASE_ORDER_NOT_ELIGIBLE');
    if (currencyCode && currencyCode !== purchaseOrder.currencyCode)
      inventoryConflict('BILL_CURRENCY_MISMATCH');
  }
  await activeSupplier(tx, org, supplierId);
  return purchaseOrder;
}
function translateInvoice(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    inventoryConflict('BILL_INVOICE_ALREADY_EXISTS');
  throw error;
}

@Injectable()
export class AccountsPayableCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: AccountsPayableQueryService,
  ) {}

  async create(org: string, actor: string, key: string, input: CreateSupplierBillDto) {
    const payload = normalized(input),
      hash = requestHash(payload);
    const id = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, commandKey(org, 'create', key));
      const existing = await tx.supplierBill.findUnique({
        where: {
          organizationId_creationIdempotencyKey: {
            organizationId: org,
            creationIdempotencyKey: key,
          },
        },
      });
      if (existing) {
        if (existing.creationRequestHash !== hash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return existing.id;
      }
      const purchase = await validReferences(tx, org, payload.supplierId, payload.purchaseOrderId);
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: org } });
      const sequence = await tx.supplierBillSequence.upsert({
        where: { organizationId: org },
        create: { organizationId: org, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const row = await tx.supplierBill.create({
        data: {
          organizationId: org,
          createdByUserId: actor,
          sequenceNumber: sequence.lastNumber,
          supplierId: payload.supplierId,
          purchaseOrderId: payload.purchaseOrderId,
          supplierInvoiceNumber: payload.supplierInvoiceNumber,
          normalizedInvoiceNumber: payload.normalizedInvoiceNumber,
          issueDate: businessDate(payload.issueDate),
          dueDate: payload.dueDate ? businessDate(payload.dueDate) : null,
          amount: payload.amount,
          currencyCode: purchase?.currencyCode ?? organization.defaultCurrency,
          description: payload.description,
          note: payload.note,
          creationIdempotencyKey: key,
          creationRequestHash: hash,
        },
      });
      return row.id;
    });
    return this.queries.get(org, id);
  }

  async update(org: string, id: string, input: UpdateSupplierBillDto) {
    await runSalesTransaction(this.prisma, async (tx) => {
      const row = await lockedBill(tx, org, id);
      if (row.status !== 'DRAFT') inventoryConflict('BILL_NOT_EDITABLE');
      const supplierId = input.supplierId ?? row.supplierId;
      const purchaseOrderId =
        input.purchaseOrderId === undefined ? row.purchaseOrderId : input.purchaseOrderId;
      const issueDate = input.issueDate ?? row.issueDate.toISOString().slice(0, 10);
      const dueDate =
        input.dueDate === undefined ? row.dueDate?.toISOString().slice(0, 10) : input.dueDate;
      if (dueDate && dueDate < issueDate)
        throw new BadRequestException('dueDate must not precede issueDate');
      await validReferences(tx, org, supplierId, purchaseOrderId, row.currencyCode);
      await tx.supplierBill.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          supplierId,
          purchaseOrderId,
          ...(input.supplierInvoiceNumber === undefined
            ? {}
            : invoice(input.supplierInvoiceNumber)),
          ...(input.issueDate === undefined ? {} : { issueDate: businessDate(input.issueDate) }),
          ...(input.dueDate === undefined
            ? {}
            : { dueDate: input.dueDate ? businessDate(input.dueDate) : null }),
          ...(input.amount === undefined ? {} : { amount: positiveAmount(input.amount) }),
          ...(input.description === undefined ? {} : { description: cleanText(input.description) }),
          ...(input.note === undefined ? {} : { note: cleanText(input.note) }),
        },
      });
    });
    return this.queries.get(org, id);
  }

  async post(org: string, id: string, key: string) {
    const hash = requestHash(['POST', id]);
    try {
      await runSalesTransaction(this.prisma, async (tx) => {
        await inventoryLock(tx, commandKey(org, 'post', key));
        const existing = await tx.supplierBill.findUnique({
          where: {
            organizationId_postingIdempotencyKey: {
              organizationId: org,
              postingIdempotencyKey: key,
            },
          },
        });
        if (existing) {
          if (existing.id !== id || existing.postingRequestHash !== hash)
            inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
          return;
        }
        const row = await lockedBill(tx, org, id);
        if (row.status !== 'DRAFT') inventoryConflict('BILL_ALREADY_POSTED');
        await validReferences(tx, org, row.supplierId, row.purchaseOrderId, row.currencyCode, true);
        if (
          !row.amount.isFinite() ||
          !row.amount.gt(0) ||
          (row.dueDate && row.dueDate < row.issueDate) ||
          !Intl.supportedValuesOf('currency').includes(row.currencyCode)
        )
          inventoryConflict('BILL_NOT_POSTABLE');
        await tx.supplierBill.update({
          where: { id_organizationId: { id, organizationId: org } },
          data: {
            status: 'POSTED',
            postedAt: new Date(),
            postingIdempotencyKey: key,
            postingRequestHash: hash,
          },
        });
      });
    } catch (error) {
      translateInvoice(error);
    }
    return this.queries.get(org, id);
  }

  async void(org: string, actor: string, id: string, key: string, input: VoidSupplierBillDto) {
    const reason = cleanText(input.reason)!;
    const hash = requestHash(['VOID', id, reason]);
    await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, commandKey(org, 'void', key));
      const existing = await tx.supplierBill.findUnique({
        where: {
          organizationId_voidIdempotencyKey: { organizationId: org, voidIdempotencyKey: key },
        },
      });
      if (existing) {
        if (existing.id !== id || existing.voidRequestHash !== hash)
          inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return;
      }
      const row = await lockedBill(tx, org, id);
      if (row.status !== 'POSTED') inventoryConflict('BILL_NOT_VOIDABLE');
      if (await tx.supplierPayment.count({ where: { organizationId: org, supplierBillId: id } }))
        inventoryConflict('BILL_HAS_PAYMENTS');
      await tx.supplierBill.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedByUserId: actor,
          voidReason: reason,
          voidIdempotencyKey: key,
          voidRequestHash: hash,
        },
      });
    });
    return this.queries.get(org, id);
  }

  async pay(
    org: string,
    actor: string,
    billId: string,
    key: string,
    input: CreateSupplierPaymentDto,
  ) {
    const payload = {
      amount: positiveAmount(input.amount),
      method: input.method,
      paymentDate: input.paymentDate,
      reference: cleanText(input.reference),
      note: cleanText(input.note),
    };
    const hash = requestHash([billId, payload]);
    const paymentId = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, commandKey(org, 'payment', key));
      const existing = await tx.supplierPayment.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey: key } },
      });
      if (existing) {
        if (existing.requestHash !== hash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return existing.id;
      }
      const bill = await lockedBill(tx, org, billId);
      if (bill.status !== 'POSTED') inventoryConflict('BILL_NOT_PAYABLE');
      const paid = await tx.supplierPayment.aggregate({
        where: { organizationId: org, supplierBillId: billId },
        _sum: { amount: true },
      });
      if (
        decimal(paid._sum.amount ?? 0)
          .plus(payload.amount)
          .gt(bill.amount)
      )
        inventoryConflict('SUPPLIER_PAYMENT_EXCEEDS_OUTSTANDING');
      const payment = await tx.supplierPayment.create({
        data: {
          organizationId: org,
          supplierBillId: billId,
          createdByUserId: actor,
          amount: payload.amount,
          method: payload.method,
          paymentDate: businessDate(payload.paymentDate),
          reference: payload.reference,
          note: payload.note,
          idempotencyKey: key,
          requestHash: hash,
        },
      });
      return payment.id;
    });
    return this.queries.getPayment(org, billId, paymentId);
  }
}
