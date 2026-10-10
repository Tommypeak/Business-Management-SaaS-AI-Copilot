import type { ReactNode } from 'react';
import type { KpiComparison as Comparison, TopSellingVariant } from '@saas/types';
import { formatDecimal } from './format';
export function KpiComparison({ metric }: { metric: Comparison }) {
  const negative = metric.absoluteChange.startsWith('-'),
    zero = /^0(?:\.0+)?$/.test(metric.absoluteChange);
  return (
    <p className={`kpi-comparison ${negative ? 'decreased' : zero ? 'unchanged' : 'increased'}`}>
      <span>
        {zero ? '—' : negative ? '↓' : '↑'}{' '}
        {metric.percentageChange === null
          ? 'No prior baseline'
          : `${negative ? '' : '+'}${formatDecimal(metric.percentageChange)}%`}
      </span>
      <small>vs previous period</small>
    </p>
  );
}
export function MetricTooltip({ text }: { text: string }) {
  return (
    <span className="metric-help" tabIndex={0} aria-label={text} title={text}>
      i<span role="tooltip">{text}</span>
    </span>
  );
}
export function KpiCard({
  label,
  value,
  unit,
  metric,
  description,
  accent = false,
}: {
  label: string;
  value: string | null;
  unit?: string;
  metric?: Comparison;
  description: string;
  accent?: boolean;
}) {
  return (
    <article className={`kpi-card ${accent ? 'kpi-accent' : ''}`}>
      <div className="kpi-label">
        {label}
        <MetricTooltip text={description} />
      </div>
      <p className="kpi-value">
        {formatDecimal(value)}
        {unit && <span>{unit}</span>}
      </p>
      {metric ? (
        <KpiComparison metric={metric} />
      ) : (
        <p className="muted kpi-caption">{description}</p>
      )}
    </article>
  );
}
export function ChartCard({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`analytics-card ${wide ? 'wide' : ''}`}>
      <header>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}
export function AnalyticsErrorState({ message }: { message: string }) {
  return (
    <div className="analytics-error" role="alert">
      <strong>This block is unavailable</strong>
      <p>{message}</p>
      <p>Change the filters or refresh to try again.</p>
    </div>
  );
}
export function RestrictedWidget() {
  return (
    <div className="restricted-widget">
      <strong>Financial access required</strong>
      <p>Your role can view operational analytics. Financial metrics require Finance access.</p>
    </div>
  );
}
export function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="empty-chart">
      <p>{message}</p>
    </div>
  );
}
export function TopItemsList({ items }: { items: TopSellingVariant[] }) {
  return !items.length ? (
    <EmptyChartState message="No matching sales in the selected period" />
  ) : (
    <div className="top-items">
      {items.map((item, index) => (
        <article key={`${item.variantId}-${item.unit}-${item.type}`}>
          <span className="rank">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <strong>
              {item.itemName}
              {item.variantName ? ` · ${item.variantName}` : ''}
            </strong>
            <small>
              {item.sku ?? 'No SKU'} · {formatDecimal(item.quantitySold, item.unit)} ·{' '}
              {item.ordersCount} orders
            </small>
          </div>
          <b>{formatDecimal(item.salesAmount, item.currencyCode)}</b>
        </article>
      ))}
    </div>
  );
}
