import { Permission as P, type PermissionCode } from '@saas/types';
type Field =
  'from' | 'to' | 'locationId' | 'granularity' | 'limit' | 'variantId' | 'comparePrevious';
interface Tool {
  name: string;
  description: string;
  fields: readonly Field[];
  permissions: readonly PermissionCode[];
  route: string;
  label: string;
}
const period = ['from', 'to', 'locationId'] as const;
const sales = [P.ANALYTICS_VIEW, P.SALES_VIEW, P.FINANCE_VIEW];
export const AI_TOOLS: readonly Tool[] = [
  {
    name: 'get_business_overview',
    description: 'Operational overview for a period; includes finance only when permitted.',
    fields: period,
    permissions: [P.ANALYTICS_VIEW, P.SALES_VIEW, P.INVENTORY_VIEW, P.PURCHASING_VIEW],
    route: 'dashboard',
    label: 'Business overview',
  },
  {
    name: 'get_sales_summary',
    description:
      'Completed sales, orders, average order value and authoritative previous-period comparison.',
    fields: [...period, 'comparePrevious'],
    permissions: sales,
    route: 'analytics/sales',
    label: 'Sales Analytics',
  },
  {
    name: 'get_sales_trend',
    description: 'Sales and order counts in bounded calendar buckets.',
    fields: [...period, 'granularity'],
    permissions: sales,
    route: 'analytics/sales',
    label: 'Sales Analytics',
  },
  {
    name: 'get_top_selling_variants',
    description: 'Up to 20 historical sale snapshots, quantities with units and sales amounts.',
    fields: [...period, 'limit'],
    permissions: sales,
    route: 'analytics/sales',
    label: 'Sales Analytics',
  },
  {
    name: 'get_inventory_summary',
    description:
      'Current tracked, zero and negative stock counts. Current stock ignores date range.',
    fields: ['locationId'],
    permissions: [P.ANALYTICS_VIEW, P.INVENTORY_VIEW],
    route: 'analytics/inventory',
    label: 'Inventory Analytics',
  },
  {
    name: 'get_variant_stock',
    description:
      'Current stock of one known variant UUID, with at most 20 location balances. Never guess UUIDs.',
    fields: ['variantId', 'locationId'],
    permissions: [P.INVENTORY_VIEW],
    route: 'inventory',
    label: 'Inventory',
  },
  {
    name: 'get_purchasing_summary',
    description: 'Ordered cohort totals, lifecycle counts, receiving progress and up to 20 lines.',
    fields: period,
    permissions: [P.ANALYTICS_VIEW, P.PURCHASING_VIEW, P.FINANCE_VIEW],
    route: 'analytics/purchasing',
    label: 'Purchasing Analytics',
  },
  {
    name: 'get_finance_summary',
    description:
      'Authoritative customer receipts minus posted expenses minus supplier payments, plus current receivables/payables. Not profit. Supplier totals unavailable with a location.',
    fields: period,
    permissions: [P.FINANCE_VIEW],
    route: 'finance',
    label: 'Finance',
  },
  {
    name: 'get_cash_flow_trend',
    description:
      'Calendar cash flow from recorded receipts, expenses and supplier payments. Not profit.',
    fields: [...period, 'granularity'],
    permissions: [P.FINANCE_VIEW, P.ANALYTICS_VIEW],
    route: 'finance',
    label: 'Finance',
  },
  {
    name: 'get_accounts_payable_summary',
    description:
      'Current outstanding and overdue supplier balances and bill counts. No supplier contact or banking information.',
    fields: [],
    permissions: [P.ACCOUNTS_PAYABLE_VIEW, P.FINANCE_VIEW],
    route: 'accounts-payable',
    label: 'Accounts Payable',
  },
];
const fieldSchemas: Record<Field, object> = {
  from: {
    type: ['string', 'null'],
    description: 'YYYY-MM-DD local inclusive date; null with to=null defaults to last 30 days.',
  },
  to: { type: ['string', 'null'], description: 'YYYY-MM-DD inclusive; max 366 calendar days.' },
  locationId: {
    type: ['string', 'null'],
    description: 'Known location UUID, or null for all locations. Never invent an ID.',
  },
  variantId: { type: 'string', description: 'Known variant UUID in the current organization.' },
  granularity: { type: ['string', 'null'], enum: ['DAY', 'WEEK', 'MONTH', null] },
  limit: { type: ['integer', 'null'], minimum: 1, maximum: 20 },
  comparePrevious: { type: ['boolean', 'null'] },
};
export function permittedTools(permissions: readonly PermissionCode[]) {
  return AI_TOOLS.filter((t) => t.permissions.every((p) => permissions.includes(p))).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      strict: true,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(t.fields.map((f) => [f, fieldSchemas[f]])),
        required: t.fields,
        additionalProperties: false,
      },
    },
  }));
}
