'use client';
import { useId, useState } from 'react';
import { formatDecimal } from './format';
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}
export interface ChartPoint {
  bucket: string;
  values: Record<string, string | null>;
}
export function TrendChart({
  title,
  points,
  series,
  unit,
  emptyMessage = 'No activity in the selected period',
}: {
  title: string;
  points: ChartPoint[];
  series: ChartSeries[];
  unit: string;
  emptyMessage?: string;
}) {
  const id = useId(),
    [selected, setSelected] = useState(0);
  const nonempty = points.some((p) =>
    series.some((s) => p.values[s.key] !== null && Number(p.values[s.key]) !== 0),
  );
  if (!points.length || !nonempty)
    return (
      <div className="empty-chart">
        <span aria-hidden="true">↗</span>
        <p>{emptyMessage}</p>
        <small>Try a different date range or location.</small>
      </div>
    );
  // Floating point values are used only for drawing. Labels and table values retain API strings.
  const values = points
    .flatMap((p) => series.map((s) => Number(p.values[s.key] ?? 0)))
    .filter(Number.isFinite);
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = max - min || 1;
  const x = (i: number) => 58 + (points.length === 1 ? 0.5 : i / (points.length - 1)) * 670;
  const y = (value: number) => 214 - ((value - min) / span) * 172;
  const activeIndex = Math.min(selected, points.length - 1);
  const active = points[activeIndex]!;
  return (
    <div className="trend-chart">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="muted">{unit}</span>
      </div>
      <svg
        viewBox="0 0 760 254"
        role="img"
        aria-labelledby={id}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setSelected(
            Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(
                  ((((e.clientX - box.left) / box.width) * 760 - 58) / 670) * (points.length - 1),
                ),
              ),
            ),
          );
        }}
      >
        <title
          id={id}
        >{`${title}. Values in ${unit}. Use the point selector or data table for exact values.`}</title>
        {[0, 0.5, 1].map((f) => {
          const v = min + span * f;
          return (
            <g key={f}>
              <line x1="58" x2="728" y1={y(v)} y2={y(v)} className="chart-grid" />
              <text x="49" y={y(v) + 4} textAnchor="end" className="chart-label">
                {Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
                  v,
                )}
              </text>
            </g>
          );
        })}
        <line x1="58" x2="728" y1={y(0)} y2={y(0)} className="chart-baseline" />
        {series.map((s) => (
          <polyline
            key={s.key}
            points={points.map((p, i) => `${x(i)},${y(Number(p.values[s.key] ?? 0))}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth="3"
            strokeLinejoin="round"
          />
        ))}
        <line x1={x(activeIndex)} x2={x(activeIndex)} y1="36" y2="218" className="chart-cursor" />
        {series.map((s) => (
          <circle
            key={s.key}
            cx={x(activeIndex)}
            cy={y(Number(active.values[s.key] ?? 0))}
            r="4"
            fill={s.color}
          >
            <title>{`${s.label}: ${formatDecimal(active.values[s.key] ?? null, unit)}`}</title>
          </circle>
        ))}
        <text x="58" y="244" className="chart-label">
          {points[0]!.bucket}
        </text>
        <text x="728" y="244" textAnchor="end" className="chart-label">
          {points.at(-1)!.bucket}
        </text>
      </svg>
      <div className="chart-tooltip" aria-live="polite">
        <strong>{active.bucket}</strong>
        {series.map((s) => (
          <span key={s.key}>
            {s.label}: <b>{formatDecimal(active.values[s.key] ?? null, unit)}</b>
          </span>
        ))}
      </div>
      <label className="chart-selector">
        Explore data point
        <input
          aria-label={`${title} data point`}
          type="range"
          min="0"
          max={Math.max(0, points.length - 1)}
          value={activeIndex}
          onChange={(e) => setSelected(Number(e.target.value))}
        />
      </label>
      <details className="chart-data">
        <summary>View accessible data table</summary>
        <div className="table-scroll">
          <table className="catalog-table">
            <caption className="sr-only">
              {title}, {unit}
            </caption>
            <thead>
              <tr>
                <th>Period starts</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.bucket}>
                  <td>{p.bucket}</td>
                  {series.map((s) => (
                    <td key={s.key}>{formatDecimal(p.values[s.key] ?? null, unit)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
