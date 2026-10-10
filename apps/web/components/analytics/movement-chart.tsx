'use client';
import { useState } from 'react';
import type { InventoryMovementPoint } from '@saas/types';
import { TrendChart } from './chart';
export function MovementChart({ points }: { points: InventoryMovementPoint[] }) {
  const groups = [...new Set(points.map((p) => `${p.unit}|${p.type}`))];
  const [selected, setSelected] = useState(groups[0] ?? '');
  const active = groups.includes(selected) ? selected : (groups[0] ?? '');
  const [unit, type] = active.split('|');
  return (
    <>
      <label className="field">
        Unit and operation
        <select value={active} onChange={(e) => setSelected(e.target.value)}>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g.replace('|', ' · ')}
            </option>
          ))}
        </select>
      </label>
      <TrendChart
        title="Inventory movement"
        unit={unit ?? 'units'}
        points={points
          .filter((p) => p.unit === unit && p.type === type)
          .map((p) => ({
            bucket: p.bucket,
            values: { inbound: p.inbound, outbound: p.outbound, net: p.net },
          }))}
        series={[
          { key: 'inbound', label: 'Inbound', color: 'var(--chart-1)' },
          { key: 'outbound', label: 'Outbound', color: 'var(--chart-3)' },
          { key: 'net', label: 'Net movement', color: 'var(--chart-2)' },
        ]}
      />
    </>
  );
}
