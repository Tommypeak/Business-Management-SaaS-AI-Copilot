import Link from 'next/link';
import { Permission, type PurchaseOrderListItem, type SupplierResponse } from '@saas/types';
import { api, list } from '../../../../../../lib/api';
import { purchasingRoot } from '../../../../../../lib/purchasing';
import { BillForm } from '../forms';

export default async function NewSupplierBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.ACCOUNTS_PAYABLE_MANAGE))
    return <p>You do not have permission to create Supplier Bills.</p>;
  const [suppliers, orders] = await Promise.all([
    permissions.includes(Permission.SUPPLIERS_VIEW)
      ? list<SupplierResponse>(`${purchasingRoot(org)}/suppliers`)
      : Promise.resolve([]),
    permissions.includes(Permission.PURCHASING_VIEW)
      ? list<PurchaseOrderListItem>(`${purchasingRoot(org)}/purchasing/orders`)
      : Promise.resolve([]),
  ]);
  const today = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: organization.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  const paramsValue = await searchParams;
  const suggestedOrderId =
    typeof paramsValue.purchaseOrderId === 'string' ? paramsValue.purchaseOrderId : undefined;
  return (
    <div className="space-y-4">
      <Link className="underline" href={`/app/${org}/accounts-payable`}>
        All bills
      </Link>
      <h2 className="text-xl font-semibold">New Supplier Bill</h2>
      <p>
        Save a draft, review it, then post the payable. A Purchase Order total is only a suggestion.
      </p>
      {suppliers.some((row) => row.isActive) ? (
        <BillForm
          org={org}
          suppliers={suppliers}
          orders={orders}
          defaultDate={`${today.year}-${today.month}-${today.day}`}
          suggestedOrderId={suggestedOrderId}
        />
      ) : (
        <p>An active Supplier is required. You may need Supplier viewing permission.</p>
      )}
    </div>
  );
}
