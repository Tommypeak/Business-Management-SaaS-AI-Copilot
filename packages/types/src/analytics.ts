import type { FinanceSummaryResponse, ExpenseCategoryBreakdownResponse } from './expenses.js';

export type AnalyticsGranularity = 'DAY' | 'WEEK' | 'MONTH';
export interface AnalyticsPeriod {
  from: string;
  to: string;
}
export interface AnalyticsFilters extends AnalyticsPeriod {
  locationId?: string;
  granularity: AnalyticsGranularity;
}
export interface AnalyticsContext extends AnalyticsFilters {
  timezone: string;
  previous: AnalyticsPeriod;
}
export interface KpiComparison {
  currentValue: string;
  previousValue: string;
  absoluteChange: string;
  percentageChange: string | null;
}
export interface KpiMetric extends KpiComparison {
  currencyCode: string;
}
export interface SalesAnalyticsSummary {
  context: AnalyticsContext;
  currencyCode: string;
  sales: KpiComparison;
  orders: KpiComparison;
  averageOrderValue: string | null;
  byLocation: { locationId: string | null; name: string; amount: string; ordersCount: number }[];
  byType: { type: 'PRODUCT' | 'SERVICE' | 'UNKNOWN'; amount: string }[];
}
export interface SalesTrendPoint {
  bucket: string;
  salesAmount: string;
  ordersCount: number;
}
export interface SalesTrendResponse {
  context: AnalyticsContext;
  currencyCode: string;
  points: SalesTrendPoint[];
}
export interface TopSellingVariant {
  variantId: string;
  itemName: string;
  variantName: string | null;
  sku: string | null;
  unit: string;
  type: 'PRODUCT' | 'SERVICE' | 'UNKNOWN';
  quantitySold: string;
  salesAmount: string;
  ordersCount: number;
  currencyCode: string;
}
export interface InventoryAnalyticsSummary {
  context: AnalyticsContext;
  trackedVariants: number;
  zeroStock: number;
  negativeStock: number;
  negativeLocationBalances: number;
  archivedNonZeroVariants: number;
  topMovingVariants: {
    variantId: string;
    name: string;
    unit: string;
    movementCount: number;
    inbound: string;
    outbound: string;
  }[];
}
export interface InventoryMovementPoint {
  bucket: string;
  unit: string;
  type: string;
  inbound: string;
  outbound: string;
  net: string;
  entriesCount: number;
}
export interface InventoryLocationSummary {
  locationId: string;
  name: string;
  isActive: boolean;
  trackedVariants: number;
  zeroStock: number;
  negativeStock: number;
  movementCount: number;
}
export interface PurchasingAnalyticsSummary {
  context: AnalyticsContext;
  currencyCode: string;
  orderedAmount: KpiComparison;
  purchaseOrdersCount: number;
  openOrders: number;
  partiallyReceivedOrders: number;
  fullyReceivedOrders: number;
  goodsReceiptsCount: number;
  linesCount: number;
  fullyReceivedLines: number;
  receivingProgressPercentage: string | null;
  topSuppliers: { supplierId: string; name: string; ordersCount: number; amount: string }[];
  receiptTrend: { bucket: string; count: number }[];
}
export interface ReceivingLine {
  id: string;
  purchaseOrderId: string;
  orderNumber: string;
  itemName: string;
  unit: string;
  orderedQuantity: string;
  receivedQuantity: string;
  remainingQuantity: string;
}
export interface CashFlowTrendPoint {
  bucket: string;
  customerPayments: string;
  operatingExpenses: string;
  supplierPayments: string | null;
  netCashFlow: string;
  customerRefunds: string;
}
export interface CashFlowTrendResponse {
  context: AnalyticsContext;
  currencyCode: string;
  supplierPaymentsLocationScoped: boolean;
  points: CashFlowTrendPoint[];
}
export interface FinanceAnalyticsSummary {
  context: AnalyticsContext;
  summary: FinanceSummaryResponse;
  comparisons: {
    sales: KpiComparison;
    payments: KpiComparison;
    expenses: KpiComparison;
    supplierPayments: KpiComparison | null;
    netCashFlow: KpiComparison;
  };
  expensesByCategory: ExpenseCategoryBreakdownResponse[];
}
export interface ExecutiveOverviewResponse {
  context: AnalyticsContext;
  completedOrders: number;
  trackedVariants: number;
  negativeStock: number;
  zeroStock: number;
  partiallyReceivedOrders: number;
}
export interface BusinessActivity {
  id: string;
  kind: 'SALE' | 'RECEIPT' | 'INVENTORY' | 'EXPENSE' | 'SUPPLIER_PAYMENT';
  label: string;
  recordedAt: string;
  businessDate: string | null;
  href: string;
}
