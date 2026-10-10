import type { ApiResponseSchemaHost } from '@nestjs/swagger';
type SchemaObject = ApiResponseSchemaHost['schema'];
const text: SchemaObject = { type: 'string' },
  count: SchemaObject = { type: 'integer' },
  money: SchemaObject = {
    type: 'string',
    example: '1250.0000',
    description: 'Exact decimal string',
  };
const object = (properties: Record<string, SchemaObject>): SchemaObject => ({
  type: 'object',
  properties,
});
const array = (items: SchemaObject): SchemaObject => ({ type: 'array', items });
const period = object({
  from: { type: 'string', format: 'date' },
  to: { type: 'string', format: 'date' },
});
const context = object({
  ...period.properties,
  timezone: text,
  locationId: { ...text, format: 'uuid' },
  granularity: { type: 'string', enum: ['DAY', 'WEEK', 'MONTH'] },
  previous: period,
});
const comparison = object({
  currentValue: money,
  previousValue: money,
  absoluteChange: money,
  percentageChange: { ...money, nullable: true },
});
const top = object({
  variantId: text,
  itemName: text,
  variantName: { ...text, nullable: true },
  sku: { ...text, nullable: true },
  unit: text,
  type: { type: 'string', enum: ['PRODUCT', 'SERVICE', 'UNKNOWN'] },
  quantitySold: money,
  salesAmount: money,
  ordersCount: count,
  currencyCode: text,
});
const stock = object({
  trackedVariants: count,
  zeroStock: count,
  negativeStock: count,
  negativeLocationBalances: count,
  archivedNonZeroVariants: count,
});
export const analyticsSchemas = {
  overview: object({
    context,
    completedOrders: count,
    trackedVariants: count,
    negativeStock: count,
    zeroStock: count,
    partiallyReceivedOrders: count,
  }),
  sales: object({
    context,
    currencyCode: text,
    sales: comparison,
    orders: comparison,
    averageOrderValue: { ...money, nullable: true },
    byLocation: array(
      object({
        locationId: { ...text, nullable: true },
        name: text,
        amount: money,
        ordersCount: count,
      }),
    ),
    byType: array(object({ type: text, amount: money })),
  }),
  salesTrend: object({
    context,
    currencyCode: text,
    points: array(object({ bucket: text, salesAmount: money, ordersCount: count })),
  }),
  top: array(top),
  inventory: object({
    context,
    ...stock.properties,
    topMovingVariants: array(
      object({
        variantId: text,
        name: text,
        unit: text,
        movementCount: count,
        inbound: money,
        outbound: money,
      }),
    ),
  }),
  movements: object({
    context,
    points: array(
      object({
        bucket: text,
        unit: text,
        type: text,
        inbound: money,
        outbound: money,
        net: money,
        entriesCount: count,
      }),
    ),
  }),
  locations: array(
    object({
      locationId: text,
      name: text,
      isActive: { type: 'boolean' },
      trackedVariants: count,
      zeroStock: count,
      negativeStock: count,
      movementCount: count,
    }),
  ),
  purchasing: object({
    context,
    currencyCode: text,
    orderedAmount: comparison,
    purchaseOrdersCount: count,
    openOrders: count,
    partiallyReceivedOrders: count,
    fullyReceivedOrders: count,
    goodsReceiptsCount: count,
    linesCount: count,
    fullyReceivedLines: count,
    receivingProgressPercentage: { ...money, nullable: true },
    topSuppliers: array(
      object({ supplierId: text, name: text, ordersCount: count, amount: money }),
    ),
    receiptTrend: array(object({ bucket: text, count })),
  }),
  receiving: array(
    object({
      id: text,
      purchaseOrderId: text,
      orderNumber: text,
      itemName: text,
      unit: text,
      orderedQuantity: money,
      receivedQuantity: money,
      remainingQuantity: money,
    }),
  ),
  finance: object({
    context,
    summary: object({
      currencyCode: text,
      timezone: text,
      from: text,
      to: text,
      salesAmount: money,
      paymentsCollected: money,
      expensesPaid: money,
      supplierPaymentsPaid: { ...money, nullable: true },
      netCashFlow: money,
      outstandingReceivablesCurrent: money,
      outstandingPayablesCurrent: { ...money, nullable: true },
      supplierPaymentsLocationScoped: { type: 'boolean' },
    }),
    comparisons: object({
      sales: comparison,
      payments: comparison,
      expenses: comparison,
      netCashFlow: comparison,
      supplierPayments: { ...comparison, nullable: true },
    }),
    expensesByCategory: array(
      object({ categoryId: text, categoryName: text, amount: money, count }),
    ),
  }),
  cashFlow: object({
    context,
    currencyCode: text,
    supplierPaymentsLocationScoped: { type: 'boolean' },
    points: array(
      object({
        bucket: text,
        customerPayments: money,
        operatingExpenses: money,
        supplierPayments: { ...money, nullable: true },
        netCashFlow: money,
      }),
    ),
  }),
  activity: array(
    object({
      id: text,
      kind: text,
      label: text,
      recordedAt: { type: 'string', format: 'date-time' },
      businessDate: { type: 'string', format: 'date', nullable: true },
      href: text,
    }),
  ),
};
