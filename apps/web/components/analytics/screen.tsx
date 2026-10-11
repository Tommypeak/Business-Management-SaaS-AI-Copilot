import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Permission,
  type AnalyticsFilters,
  type BusinessActivity,
  type CashFlowTrendResponse,
  type ExecutiveOverviewResponse,
  type FinanceAnalyticsSummary,
  type InventoryAnalyticsSummary,
  type InventoryLocationSummary,
  type InventoryMovementPoint,
  type PurchasingAnalyticsSummary,
  type ReceivingLine,
  type SalesAnalyticsSummary,
  type SalesTrendResponse,
  type TopSellingVariant,
  type ReturnsAnalyticsSummary,
} from '@saas/types';
import { api } from '../../lib/api';
import { analyticsRequest, type AnalyticsResult } from '../../lib/analytics';
import { DashboardFilters } from './filters';
import { TrendChart } from './chart';
import { MovementChart } from './movement-chart';
import { formatDecimal } from './format';
import {
  AnalyticsErrorState,
  ChartCard,
  EmptyChartState,
  KpiCard,
  RestrictedWidget,
  TopItemsList,
} from './widgets';
export type AnalyticsMode = 'dashboard' | 'sales' | 'inventory' | 'purchasing' | 'finance';
export type SearchParams = Record<string, string | string[] | undefined>;
function show<T>(result: AnalyticsResult<T> | null, render: (data: T) => ReactNode) {
  return result === null ? (
    <RestrictedWidget />
  ) : result.error !== undefined ? (
    <AnalyticsErrorState message={result.error} />
  ) : (
    render(result.data)
  );
}
function DataTable({
  headers,
  rows,
  empty = 'No records in the selected period',
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return !rows.length ? (
    <EmptyChartState message={empty} />
  ) : (
    <div className="table-scroll">
      <table className="catalog-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export async function AnalyticsScreen({
  org,
  mode,
  search,
}: {
  org: string;
  mode: AnalyticsMode;
  search: SearchParams;
}) {
  const organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.ANALYTICS_VIEW)) return <RestrictedWidget />;
  const financeAllowed = permissions.includes(Permission.FINANCE_VIEW);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: organization.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`,
    start = new Date(today + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - 29);
  const string = (key: string) => (typeof search[key] === 'string' ? search[key] : undefined);
  const filters: AnalyticsFilters = {
    from: string('from') ?? start.toISOString().slice(0, 10),
    to: string('to') ?? today,
    locationId: string('locationId') || undefined,
    granularity: (string('granularity') ?? 'DAY') as AnalyticsFilters['granularity'],
  };
  const compare = string('compare') !== 'none',
    query = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      granularity: filters.granularity,
      limit: '6',
    });
  if (filters.locationId) query.set('locationId', filters.locationId);
  const qs = query.toString(),
    base = `/app/${org}/${mode === 'dashboard' ? 'dashboard' : mode === 'finance' ? 'finance' : 'analytics/' + mode}`;
  const get = <T,>(path: string, enabled = true) =>
    enabled ? analyticsRequest<T>(org, path, qs) : Promise.resolve(null);
  const [
    locations,
    overview,
    finance,
    sales,
    trend,
    unknown,
    stock,
    movements,
    stockLocations,
    purchasing,
    receiving,
    cash,
    activity,
    returnsData,
  ] = await Promise.all([
    permissions.includes(Permission.LOCATIONS_VIEW) ? api.locations(org) : Promise.resolve([]),
    get<ExecutiveOverviewResponse>('overview', mode === 'dashboard'),
    get<FinanceAnalyticsSummary>(
      'finance/summary',
      financeAllowed && (mode === 'dashboard' || mode === 'finance'),
    ),
    get<SalesAnalyticsSummary>('sales/summary', financeAllowed && mode === 'sales'),
    get<SalesTrendResponse>(
      'sales/trend',
      financeAllowed && (mode === 'dashboard' || mode === 'sales'),
    ),
    get<TopSellingVariant[]>('sales/top-variants', financeAllowed && mode === 'sales'),
    get<InventoryAnalyticsSummary>('inventory/summary', mode === 'inventory'),
    get<{ points: InventoryMovementPoint[] }>('inventory/movements', mode === 'inventory'),
    get<InventoryLocationSummary[]>('inventory/locations', mode === 'inventory'),
    get<PurchasingAnalyticsSummary>(
      'purchasing/summary',
      financeAllowed && (mode === 'purchasing' || mode === 'dashboard'),
    ),
    get<ReceivingLine[]>('purchasing/receiving', mode === 'purchasing'),
    get<CashFlowTrendResponse>(
      'finance/cash-flow',
      financeAllowed && (mode === 'dashboard' || mode === 'finance'),
    ),
    mode === 'inventory'
      ? analyticsRequest<BusinessActivity[]>(org, 'activity', qs + '&kind=INVENTORY')
      : get<BusinessActivity[]>('activity', mode === 'dashboard'),
    get<ReturnsAnalyticsSummary>(
      'returns/summary',
      permissions.includes(Permission.RETURNS_VIEW) &&
        ['dashboard', 'sales', 'finance'].includes(mode),
    ),
  ]);
  const topEnabled = financeAllowed && (mode === 'dashboard' || mode === 'sales');
  const [topProducts, topServices] = await Promise.all(
    topEnabled
      ? [
          analyticsRequest<TopSellingVariant[]>(
            org,
            'sales/top-variants',
            qs + '&itemType=PRODUCT',
          ),
          analyticsRequest<TopSellingVariant[]>(
            org,
            'sales/top-variants',
            qs + '&itemType=SERVICE',
          ),
        ]
      : [Promise.resolve(null), Promise.resolve(null)],
  );
  const titles = {
    dashboard: 'Business overview',
    sales: 'Sales performance',
    inventory: 'Inventory health',
    purchasing: 'Purchasing overview',
    finance: 'Financial overview',
  };
  const renderCash = (data: CashFlowTrendResponse) => (
    <TrendChart
      title="Cash flow trend"
      unit={data.currencyCode}
      points={data.points.map((p) => ({
        bucket: p.bucket,
        values: {
          customer: p.customerPayments,
          refunds: p.customerRefunds,
          expenses: p.operatingExpenses,
          supplier: p.supplierPayments,
          net: p.netCashFlow,
        },
      }))}
      series={[
        { key: 'customer', label: 'Customer payments', color: 'var(--chart-2)' },
        { key: 'refunds', label: 'Customer refunds', color: 'var(--danger)' },
        { key: 'expenses', label: 'Operating expenses', color: 'var(--chart-3)' },
        ...(!filters.locationId
          ? [{ key: 'supplier', label: 'Supplier payments', color: 'var(--chart-4)' }]
          : []),
        { key: 'net', label: 'Net cash flow', color: 'var(--chart-1)' },
      ]}
    />
  );
  const activityList = (items: BusinessActivity[]) =>
    items.length ? (
      <ul className="activity-list">
        {items.map((i) => (
          <li key={i.kind + i.id}>
            <div>
              <Link href={i.href}>{i.label.replaceAll('_', ' ')}</Link>
              {i.businessDate && <small>Business date: {i.businessDate}</small>}
            </div>
            <time dateTime={i.recordedAt}>
              {new Intl.DateTimeFormat('en', {
                timeZone: organization.timezone,
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(i.recordedAt))}
            </time>
          </li>
        ))}
      </ul>
    ) : (
      <EmptyChartState message="No recent activity in this period" />
    );
  return (
    <div className="analytics-page">
      <header className="analytics-heading">
        <div>
          <div className="analytics-eyebrow">{organization.name} / Intelligence</div>
          <h1>{titles[mode]}</h1>
          <p>
            {mode === 'dashboard'
              ? 'A clear view of your business, from sales to stock.'
              : 'Explore the numbers behind your business.'}{' '}
            Dates in {organization.timezone}.
          </p>
        </div>
        <span className="muted text-xs">{today}</span>
      </header>
      <DashboardFilters
        key={qs}
        base={base}
        today={today}
        filters={filters}
        locations={locations}
        compare={compare}
      />
      {(mode === 'dashboard' || mode === 'finance') &&
        show(finance, (d) => (
          <>
            <div className="kpi-grid">
              <KpiCard
                label="Completed Sales"
                value={d.summary.salesAmount}
                unit={d.summary.currencyCode}
                metric={compare ? d.comparisons.sales : undefined}
                description="Completed orders by completion date."
              />
              <KpiCard
                label="Customer Payments"
                value={d.summary.paymentsCollected}
                unit={d.summary.currencyCode}
                metric={compare ? d.comparisons.payments : undefined}
                description="Recorded customer cash collected."
              />
              <KpiCard
                label="Operating Expenses"
                value={d.summary.expensesPaid}
                unit={d.summary.currencyCode}
                metric={compare ? d.comparisons.expenses : undefined}
                description="Posted expenses by business date."
              />
              <KpiCard
                label="Net Cash Flow"
                value={d.summary.netCashFlow}
                unit={d.summary.currencyCode}
                metric={compare ? d.comparisons.netCashFlow : undefined}
                description="Customer payments minus customer refunds, operating expenses and supplier payments."
                accent
              />
            </div>
            {compare && (
              <p className="muted text-xs">
                Compared with {d.context.previous.from} — {d.context.previous.to}, the previous
                period of equal length.
              </p>
            )}
          </>
        ))}
      {mode === 'sales' &&
        show(sales, (d) => (
          <div className="kpi-grid">
            <KpiCard
              label="Completed Sales"
              value={d.sales.currentValue}
              unit={d.currencyCode}
              metric={compare ? d.sales : undefined}
              description="Only completed orders."
            />
            <KpiCard
              label="Completed Orders"
              value={d.orders.currentValue}
              metric={compare ? d.orders : undefined}
              description="Orders completed in this period."
            />
            <KpiCard
              label="Average Order Value"
              value={d.averageOrderValue}
              unit={d.currencyCode}
              description="Completed sales divided by completed orders."
            />
            <KpiCard
              label="Historical classification"
              value={String(d.byType.filter((r) => r.type !== 'UNKNOWN').length)}
              description="Recorded product/service types. Older sales can be Unknown."
            />
          </div>
        ))}
      {returnsData &&
        show(returnsData, (d) => (
          <section className="space-y-4">
            <h3 className="text-lg font-semibold">Customer returns & refunds</h3>
            <div className="kpi-grid">
              <KpiCard
                label="Posted returns"
                value={String(d.returnsCount)}
                description="Events by posting date in the organization timezone."
              />
              {d.financeVisible && (
                <>
                  <KpiCard
                    label="Return credits"
                    value={d.postedReturnCredits ?? '0'}
                    unit={d.currencyCode ?? undefined}
                    description="Reduces sales and receivables; no cash payout."
                  />
                  <KpiCard
                    label="Customer refunds"
                    value={d.customerRefundsPaid ?? '0'}
                    unit={d.currencyCode ?? undefined}
                    description="Actual recorded cash outflows by payment date."
                  />
                </>
              )}
            </div>
            <p className="muted text-sm">
              Gross sales and average order value preserve original completed orders. Return events
              may relate to sales from earlier periods. Quantities below are grouped by unit and
              historical type.
            </p>
            <DataTable
              headers={['Returned item', 'Historic type', 'Quantity & unit', 'Return credit']}
              rows={d.topReturnedVariants.map((v) => [
                v.itemName,
                v.type,
                `${v.quantityReturned} ${v.unit}`,
                v.returnCredits === null
                  ? 'Finance access required'
                  : `${v.returnCredits} ${d.currencyCode}`,
              ])}
            />
            <details>
              <summary>Return & refund calendar trend</summary>
              <DataTable
                headers={['Bucket', 'Posted returns', 'Return credits', 'Refund payouts']}
                rows={d.trend.map((t) => [
                  t.bucket,
                  t.returnsCount,
                  t.postedReturnCredits ?? 'Finance access required',
                  t.customerRefundsPaid ?? 'Finance access required',
                ])}
              />
            </details>
            <Link className="underline" href={`/app/${org}/returns`}>
              Open customer returns
            </Link>
          </section>
        ))}
      {mode === 'inventory' &&
        show(stock, (d) => (
          <div className="kpi-grid">
            <KpiCard
              label="Tracked Variants"
              value={String(d.trackedVariants)}
              description="Active tracked products plus archived nonzero stock."
            />
            <KpiCard
              label="Zero Stock"
              value={String(d.zeroStock)}
              description="Missing balances count as zero."
            />
            <KpiCard
              label="Negative Stock"
              value={String(d.negativeStock)}
              description="Variants with a negative aggregate balance."
            />
            <KpiCard
              label="Negative Location Balances"
              value={String(d.negativeLocationBalances)}
              description="Negative balances remain visible even when other locations offset them."
              accent
            />
          </div>
        ))}
      {mode === 'purchasing' &&
        show(purchasing, (d) => (
          <div className="kpi-grid">
            <KpiCard
              label="Ordered Amount"
              value={d.orderedAmount.currentValue}
              unit={d.currencyCode}
              metric={compare ? d.orderedAmount : undefined}
              description="Non-cancelled orders placed in the selected period."
            />
            <KpiCard
              label="Purchase Orders"
              value={String(d.purchaseOrdersCount)}
              description={`${d.openOrders} open · ${d.partiallyReceivedOrders} partially received`}
            />
            <KpiCard
              label="Fully Received Orders"
              value={String(d.fullyReceivedOrders)}
              description="Current completion of orders placed in this period."
            />
            <KpiCard
              label="Receiving Progress"
              value={d.receivingProgressPercentage}
              unit="%"
              description={`${d.fullyReceivedLines} of ${d.linesCount} lines fully received; quantities of different units are not combined.`}
            />
          </div>
        ))}
      <div className="analytics-grid">
        {(mode === 'dashboard' || mode === 'sales') && (
          <ChartCard
            title="Sales trend"
            description="Completed sales · local calendar periods · exact values in the data table"
            wide
          >
            {show(trend, (d) => (
              <TrendChart
                title="Sales trend"
                unit={d.currencyCode}
                points={d.points.map((p) => ({
                  bucket: p.bucket,
                  values: { sales: p.salesAmount },
                }))}
                series={[{ key: 'sales', label: 'Completed sales', color: 'var(--chart-1)' }]}
                emptyMessage="No sales in the selected period"
              />
            ))}
          </ChartCard>
        )}
        {(mode === 'dashboard' || mode === 'finance') && (
          <ChartCard
            title="Cash flow trend"
            description="Recorded cash movement over the selected period"
            wide={mode === 'finance'}
          >
            {show(cash, renderCash)}
          </ChartCard>
        )}
        {mode === 'dashboard' && (
          <ChartCard
            title="Business highlights"
            description="Deterministic signals from your operational records"
          >
            {show(overview, (d) => (
              <ul className="insight-list">
                <li>
                  {d.completedOrders} orders completed
                  <small>Source: completed Sales Orders in the selected period.</small>
                </li>
                <li>
                  {d.zeroStock} tracked variants have zero stock
                  <small>Source: current Inventory Balances, including missing balances.</small>
                </li>
                <li>
                  {d.negativeStock} variants have negative stock
                  <small>Source: current balances across the selected locations.</small>
                </li>
                <li>
                  {d.partiallyReceivedOrders} purchase orders are partially received
                  <small>Source: Purchase Orders placed in the selected period.</small>
                </li>
              </ul>
            ))}
          </ChartCard>
        )}
        {(mode === 'dashboard' || mode === 'sales') && (
          <>
            <ChartCard
              title="Top selling products"
              description="Ranked by sales amount · latest historical name within this period"
            >
              {show(topProducts, (d) => (
                <TopItemsList items={d} />
              ))}
            </ChartCard>
            <ChartCard
              title="Top services"
              description="Ranked by sales amount · only recorded service snapshots"
            >
              {show(topServices, (d) => (
                <TopItemsList items={d} />
              ))}
            </ChartCard>
          </>
        )}
        {mode === 'sales' && (
          <>
            <ChartCard title="Sales by location" description="Top 50 locations by completed sales">
              {show(sales, (d) => (
                <DataTable
                  headers={['Location', 'Sales', 'Orders']}
                  rows={d.byLocation.map((r) => [
                    r.name,
                    formatDecimal(r.amount, d.currencyCode),
                    r.ordersCount,
                  ])}
                />
              ))}
            </ChartCard>
            <ChartCard
              title="Product and service mix"
              description="Older records without an item type snapshot are Unknown"
            >
              {show(sales, (d) => (
                <DataTable
                  headers={['Historical type', 'Sales amount']}
                  rows={d.byType.map((r) => [r.type, formatDecimal(r.amount, d.currencyCode)])}
                />
              ))}
            </ChartCard>
            <ChartCard
              title="Top variants, all historical types"
              description="Each variant and unit is ranked separately"
              wide
            >
              {show(unknown, (d) => (
                <TopItemsList items={d} />
              ))}
            </ChartCard>
          </>
        )}
        {mode === 'inventory' && (
          <>
            <ChartCard
              title="Inventory movements"
              description="Signed ledger entries, separated by unit and operation. Transfers conserve organization stock."
              wide
            >
              {show(movements, (d) => (
                <MovementChart points={d.points} />
              ))}
            </ChartCard>
            <ChartCard
              title="Stock by location"
              description="Current stock health; movement counts use the selected period"
              wide
            >
              {show(stockLocations, (d) => (
                <DataTable
                  headers={['Location', 'Tracked', 'Zero', 'Negative', 'Movements']}
                  rows={d.map((r) => [
                    r.name + (r.isActive ? '' : ' (archived)'),
                    r.trackedVariants,
                    r.zeroStock,
                    r.negativeStock,
                    r.movementCount,
                  ])}
                />
              ))}
            </ChartCard>
            <ChartCard
              title="Top moving variants"
              description="Ranked by ledger entry count; units are never combined"
            >
              {show(stock, (d) => (
                <DataTable
                  headers={['Variant', 'Unit', 'Movements', 'Inbound', 'Outbound']}
                  rows={d.topMovingVariants.map((r) => [
                    r.name,
                    r.unit,
                    r.movementCount,
                    formatDecimal(r.inbound),
                    formatDecimal(r.outbound),
                  ])}
                />
              ))}
            </ChartCard>
          </>
        )}
        {(mode === 'purchasing' || mode === 'dashboard') && (
          <ChartCard
            title="Purchasing overview"
            description="Orders placed in period, excluding cancelled and draft orders"
          >
            {show(purchasing, (d) => (
              <>
                <p className="analytics-note">
                  {d.purchaseOrdersCount} orders · {d.openOrders} open · {d.goodsReceiptsCount}{' '}
                  goods receipts in period. Goods receipts do not represent cash payments.
                </p>
                <DataTable
                  headers={['Supplier', 'Orders', 'Ordered amount']}
                  rows={d.topSuppliers.map((r) => [
                    r.name,
                    r.ordersCount,
                    formatDecimal(r.amount, d.currencyCode),
                  ])}
                />
              </>
            ))}
          </ChartCard>
        )}
        {mode === 'purchasing' && (
          <>
            <ChartCard title="Goods receipts" description="Receipt events by received date">
              {show(purchasing, (d) => (
                <TrendChart
                  title="Goods receipts"
                  unit="receipts"
                  points={d.receiptTrend.map((r) => ({
                    bucket: r.bucket,
                    values: { count: String(r.count) },
                  }))}
                  series={[{ key: 'count', label: 'Receipts', color: 'var(--chart-2)' }]}
                />
              ))}
            </ChartCard>
            <ChartCard
              title="Receiving progress by line"
              description="Current received quantity for the most recently ordered lines in period"
              wide
            >
              {show(receiving, (d) => (
                <DataTable
                  headers={['Order', 'Item', 'Unit', 'Ordered', 'Received', 'Remaining']}
                  rows={d.map((r) => [
                    <Link key={r.id} href={`/app/${org}/purchasing/${r.purchaseOrderId}`}>
                      {r.orderNumber}
                    </Link>,
                    r.itemName,
                    r.unit,
                    formatDecimal(r.orderedQuantity),
                    formatDecimal(r.receivedQuantity),
                    formatDecimal(r.remainingQuantity),
                  ])}
                />
              ))}
            </ChartCard>
          </>
        )}
        {(mode === 'dashboard' || mode === 'finance') && (
          <ChartCard
            title="Current commitments"
            description="Current balances, independent of the selected date range"
          >
            {show(finance, (d) => (
              <div className="space-y-5">
                <KpiCard
                  label="Current Outstanding Receivables"
                  value={d.summary.outstandingReceivablesCurrent}
                  unit={d.summary.currencyCode}
                  description="Amount still owed on completed sales."
                />
                <KpiCard
                  label="Current Outstanding Payables"
                  value={d.summary.outstandingPayablesCurrent}
                  unit={d.summary.currencyCode}
                  description={
                    filters.locationId
                      ? 'Not allocated to individual locations.'
                      : 'Outstanding posted supplier bills.'
                  }
                />
                <KpiCard
                  label="Supplier Payments"
                  value={d.summary.supplierPaymentsPaid}
                  unit={d.summary.currencyCode}
                  metric={compare ? (d.comparisons.supplierPayments ?? undefined) : undefined}
                  description="Actual payments by business date in the selected period."
                />
              </div>
            ))}
          </ChartCard>
        )}
        {mode === 'finance' && (
          <ChartCard
            title="Expenses by category"
            description="Posted operating expenses in the selected period"
          >
            {show(finance, (d) => (
              <DataTable
                headers={['Category', 'Amount', 'Records']}
                rows={d.expensesByCategory.map((r) => [
                  r.categoryName,
                  formatDecimal(r.amount, d.summary.currencyCode),
                  r.count,
                ])}
              />
            ))}
          </ChartCard>
        )}
        {(mode === 'dashboard' || mode === 'inventory') && (
          <ChartCard
            title={
              mode === 'inventory' ? 'Recent inventory transactions' : 'Recent business activity'
            }
            description={`Recording chronology · ${organization.timezone}`}
          >
            {show(activity, activityList)}
          </ChartCard>
        )}
      </div>
      {filters.locationId && (mode === 'dashboard' || mode === 'finance') && (
        <p className="analytics-note">
          Supplier payments are not allocated to individual locations. Supplier payment and payable
          totals are N/A; location net cash flow includes customer payments minus customer refunds
          and location expenses.
        </p>
      )}
      {(mode === 'dashboard' || mode === 'finance') && (
        <p className="analytics-note">
          Net Cash Flow is not Net Profit. It reflects customer payments minus customer refunds and
          recorded operating expenses and supplier payments actually made. It is not a complete bank
          statement and excludes inventory valuation, COGS, taxes and accounting adjustments.
        </p>
      )}
      {mode === 'inventory' && (
        <p className="analytics-note">
          Stock is current. Active tracked product variants with no balance are zero; archived
          nonzero stock remains visible. Unit changes are blocked after ledger history exists.
          Movement labels use current catalog names. Quantities of different units are never added
          together.
        </p>
      )}
      {mode === 'dashboard' && (
        <nav className="quick-actions" aria-label="Quick actions">
          {(
            [
              [Permission.SALES_CREATE, 'sales/new', 'New sale'],
              [Permission.PURCHASING_CREATE, 'purchasing/new', 'New purchase order'],
              [Permission.PURCHASING_RECEIVE, 'purchasing?status=ORDERED', 'Receive goods'],
              [Permission.EXPENSES_MANAGE, 'expenses/new', 'Add expense'],
              [Permission.INVENTORY_VIEW, 'inventory', 'Open inventory'],
            ] as const
          )
            .filter(([p]) => permissions.includes(p))
            .map(([, href, label]) => (
              <Link key={href} href={`/app/${org}/${href}`}>
                + {label}
              </Link>
            ))}
        </nav>
      )}
    </div>
  );
}
