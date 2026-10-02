import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { catalogApi } from '../../../../../../lib/catalog';
import { ItemForm, VariantForm } from '../item-form';
import { OptionForm, OptionValueForm } from '../management-forms';
import { fieldLabel } from '../presentation';

export default async function ItemPage({
  params,
}: {
  params: Promise<{ organizationId: string; itemId: string }>;
}) {
  const { organizationId: org, itemId } = await params;
  const [organization, item, categories, fields] = await Promise.all([
    api.organization(org),
    catalogApi.item(org, itemId),
    catalogApi.categories(org),
    catalogApi.fields(org),
  ]);
  const manage = organization.currentMembership.permissions.includes(Permission.CATALOG_MANAGE);
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">{item.name}</h2>
        <p className="text-slate-500">
          {item.type} · {item.isActive ? 'Active' : 'Archived'} ·{' '}
          {item.category?.name ?? 'Uncategorized'}
        </p>
      </header>
      {manage ? (
        <details className="space-y-4">
          <summary className="cursor-pointer font-medium underline">
            Edit item and custom fields
          </summary>
          <ItemForm
            org={org}
            currency={item.currencyCode}
            categories={categories}
            fields={fields}
            item={item}
          />
        </details>
      ) : (
        <p className="text-sm text-slate-500">Read-only catalog access</p>
      )}
      <section className="panel space-y-3">
        <h3 className="font-semibold">Basic information</h3>
        <p className="whitespace-pre-wrap break-words">{item.description ?? 'No description'}</p>
        <p>Inventory tracking: {item.trackInventory ? 'Enabled' : 'Off'}</p>
        <h3 className="font-semibold">Custom fields</h3>
        {item.customFields.length ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            {item.customFields.map((entry) => {
              const definition = fields.find((field) => field.id === entry.fieldId);
              return (
                <div key={entry.fieldId}>
                  <dt className="text-sm text-slate-500">
                    {definition?.name ?? 'Custom field'}
                    {definition?.isActive === false ? ' (archived)' : ''}
                  </dt>
                  <dd className="break-words">{fieldLabel(definition, entry.value)}</dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="text-slate-500">No custom values.</p>
        )}
      </section>
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Variants and pricing</h3>
        {item.variants.map((variant) => (
          <article className="panel space-y-4" key={variant.id}>
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h4 className="font-semibold">
                  {variant.name ?? 'Unnamed variant'}
                  {variant.isDefault ? ' · Default' : ''}
                </h4>
                <p className="text-sm text-slate-500">
                  {variant.isActive ? 'Active' : 'Archived'} · {variant.unit}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p>
                  {variant.sellingPrice} {item.currencyCode}
                </p>
                <p className="text-sm text-slate-500">
                  Cost: {variant.costPrice ?? '—'} {variant.costPrice ? item.currencyCode : ''}
                </p>
              </div>
            </div>
            <p className="text-sm">
              SKU: {variant.sku ?? '—'} · Barcode: {variant.barcode ?? '—'}
            </p>
            {variant.optionValueIds.length > 0 && (
              <p className="text-sm">
                {item.options
                  .flatMap((option) =>
                    option.values
                      .filter((value) => variant.optionValueIds.includes(value.id))
                      .map((value) => `${option.name}: ${value.value}`),
                  )
                  .join(' · ')}
              </p>
            )}
            {manage && (
              <details className="space-y-4">
                <summary className="cursor-pointer underline">Edit variant</summary>
                <VariantForm
                  org={org}
                  itemId={item.id}
                  currency={item.currencyCode}
                  options={item.options}
                  variant={variant}
                />
              </details>
            )}
          </article>
        ))}
        {manage && item.isActive && (
          <details className="panel space-y-4">
            <summary className="cursor-pointer font-semibold">Add variant</summary>
            <VariantForm
              org={org}
              itemId={item.id}
              currency={item.currencyCode}
              options={item.options}
            />
          </details>
        )}
      </section>
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Variant options</h3>
        {item.options.map((option) => (
          <article className="panel space-y-4" key={option.id}>
            <h4 className="font-semibold">
              {option.name}
              {option.isActive ? '' : ' (archived)'}
            </h4>
            <p className="text-sm text-slate-600">
              {option.values
                .map((value) => `${value.value}${value.isActive ? '' : ' (archived)'}`)
                .join(', ') || 'No values yet'}
            </p>
            {manage && (
              <>
                <details className="space-y-4">
                  <summary className="cursor-pointer underline">Edit option</summary>
                  <OptionForm org={org} itemId={item.id} option={option} />
                </details>
                {option.isActive && (
                  <>
                    {option.values.map((value) => (
                      <details className="space-y-4" key={value.id}>
                        <summary className="cursor-pointer underline">
                          Edit value: {value.value}
                        </summary>
                        <OptionValueForm
                          org={org}
                          itemId={item.id}
                          optionId={option.id}
                          value={value}
                        />
                      </details>
                    ))}
                    <details className="space-y-4">
                      <summary className="cursor-pointer underline">Add value</summary>
                      <OptionValueForm org={org} itemId={item.id} optionId={option.id} />
                    </details>
                  </>
                )}
              </>
            )}
          </article>
        ))}
        {manage && (
          <details className="panel space-y-4">
            <summary className="cursor-pointer font-semibold">Add variant option</summary>
            <OptionForm org={org} itemId={item.id} />
          </details>
        )}
      </section>
    </div>
  );
}
