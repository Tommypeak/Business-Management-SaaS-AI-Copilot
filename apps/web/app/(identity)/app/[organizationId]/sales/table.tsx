import Link from 'next/link';
import type { SalesOrderListItem } from '@saas/types';
export function SalesTable({ org, orders }: { org: string; orders: SalesOrderListItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="catalog-table">
        <thead>
          <tr>
            {[
              'Order',
              'Date',
              'Customer',
              'Location',
              'Status',
              'Total',
              'Paid',
              'Outstanding',
              'Payment status',
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <Link className="underline" href={`/app/${org}/sales/${o.id}`}>
                  SO-{String(o.sequenceNumber).padStart(6, '0')}
                </Link>
              </td>
              <td>{o.createdAt.replace('T', ' ').slice(0, 19)} UTC</td>
              <td>{o.customer?.name ?? 'Walk-in'}</td>
              <td>{o.location?.name ?? 'Not assigned'}</td>
              <td>{o.status}</td>
              <td>
                {o.total} {o.currencyCode}
              </td>
              <td>{o.paidAmount}</td>
              <td>{o.outstandingAmount}</td>
              <td>{o.paymentStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!orders.length && <p className="p-4">No sales found.</p>}
    </div>
  );
}
