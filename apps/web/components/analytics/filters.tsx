'use client';
import { useState } from 'react';
import type { AnalyticsFilters, LocationResponse } from '@saas/types';
const shift = (day: string, n: number) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export function DashboardFilters({
  base,
  today,
  filters,
  locations,
  compare,
}: {
  base: string;
  today: string;
  filters: AnalyticsFilters;
  locations: LocationResponse[];
  compare: boolean;
}) {
  const [from, setFrom] = useState(filters.from),
    [to, setTo] = useState(filters.to);
  function preset(value: string) {
    const year = today.slice(0, 4),
      month = today.slice(0, 7),
      monthStart = month + '-01';
    if (value === 'custom') return;
    let start = today,
      end = today;
    if (value === 'yesterday') start = end = shift(today, -1);
    if (value === '7') start = shift(today, -6);
    if (value === '30') start = shift(today, -29);
    if (value === 'month') start = monthStart;
    if (value === 'last-month') {
      end = shift(monthStart, -1);
      start = end.slice(0, 7) + '-01';
    }
    if (value === 'year') start = year + '-01-01';
    setFrom(start);
    setTo(end);
  }
  return (
    <form action={base} className="analytics-filters">
      <label className="field">
        Date range
        <select
          aria-label="Date range preset"
          defaultValue="custom"
          onChange={(e) => preset(e.target.value)}
        >
          <option value="custom">Custom range</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="month">This month</option>
          <option value="last-month">Last month</option>
          <option value="year">This year</option>
        </select>
      </label>
      <label className="field">
        From
        <input
          name="from"
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="field">
        To
        <input name="to" type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="field">
        Location
        <select name="locationId" defaultValue={filters.locationId ?? ''}>
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.isActive ? '' : ' (archived)'}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Group by
        <select name="granularity" defaultValue={filters.granularity}>
          <option value="DAY">Day</option>
          <option value="WEEK">ISO week</option>
          <option value="MONTH">Month</option>
        </select>
      </label>
      <label className="field">
        Comparison
        <select name="compare" defaultValue={compare ? 'previous' : 'none'}>
          <option value="previous">Previous period</option>
          <option value="none">No comparison</option>
        </select>
      </label>
      <button className="button" type="submit">
        Apply
      </button>
    </form>
  );
}
