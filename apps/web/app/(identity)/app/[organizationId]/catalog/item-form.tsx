'use client';
import { useActionState, useState } from 'react';
import {
  CATALOG_ITEM_TYPES,
  type CatalogCategoryResponse,
  type CatalogItemResponse,
  type CatalogOptionResponse,
  type CatalogVariantResponse,
  type CustomFieldDefinitionResponse,
} from '@saas/types';
import { saveItem, saveVariant } from './actions';
import { Active, Feedback, PricingFields } from './form-controls';
import { categoryLabel } from './presentation';

function CustomInputs({
  fields,
  item,
}: {
  fields: CustomFieldDefinitionResponse[];
  item?: CatalogItemResponse;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields
        .filter((field) => field.isActive)
        .map((field) => {
          const name = `custom_${field.id}`;
          const value = item?.customFields.find((entry) => entry.fieldId === field.id)?.value;
          const scalar =
            typeof value === 'string' ? value : typeof value === 'boolean' ? String(value) : '';
          let control;
          if (field.type === 'BOOLEAN')
            control = (
              <select name={name} required={field.isRequired} defaultValue={scalar}>
                <option value="">Not set</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            );
          else if (field.type === 'SELECT' || field.type === 'MULTI_SELECT')
            control = (
              <select
                name={name}
                multiple={field.type === 'MULTI_SELECT'}
                required={field.isRequired}
                defaultValue={
                  field.type === 'MULTI_SELECT' ? (Array.isArray(value) ? value : []) : scalar
                }
              >
                {field.type === 'SELECT' && <option value="">Choose an option</option>}
                {field.options
                  .filter((option) => option.isActive)
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
              </select>
            );
          else
            control = (
              <input
                name={name}
                type={field.type === 'DATE' ? 'date' : 'text'}
                inputMode={field.type === 'NUMBER' ? 'decimal' : undefined}
                pattern={
                  field.type === 'NUMBER' ? '-?(0|[1-9][0-9]{0,29})(\\.[0-9]{1,8})?' : undefined
                }
                maxLength={field.type === 'TEXT' ? 2000 : 40}
                required={field.isRequired}
                defaultValue={scalar}
              />
            );
          return (
            <label key={field.id} className="field">
              {field.name}
              {field.isRequired ? ' *' : ''}
              {control}
              {field.type === 'MULTI_SELECT' && (
                <span className="text-xs font-normal text-slate-500">
                  Select one or more options.
                </span>
              )}
            </label>
          );
        })}
    </div>
  );
}

export function ItemForm({
  org,
  currency,
  categories,
  fields,
  item,
}: {
  org: string;
  currency: string;
  categories: CatalogCategoryResponse[];
  fields: CustomFieldDefinitionResponse[];
  item?: CatalogItemResponse;
}) {
  const [state, action, pending] = useActionState(saveItem.bind(null, org, item?.id ?? null), {});
  const [type, setType] = useState(item?.type ?? 'PRODUCT');
  const [track, setTrack] = useState(item?.trackInventory ?? false);
  return (
    <form action={action} className="panel space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          Type
          <select
            name="type"
            value={type}
            onChange={(event) => {
              const next = CATALOG_ITEM_TYPES.find((type) => type === event.target.value);
              if (next) {
                setType(next);
                if (next === 'SERVICE') setTrack(false);
              }
            }}
          >
            {CATALOG_ITEM_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Name
          <input name="name" required maxLength={200} defaultValue={item?.name} />
        </label>
        <label className="field sm:col-span-2">
          Description
          <textarea
            name="description"
            maxLength={5000}
            rows={3}
            defaultValue={item?.description ?? ''}
          />
        </label>
        <label className="field">
          Category
          <select name="categoryId" defaultValue={item?.categoryId ?? ''}>
            <option value="">Uncategorized</option>
            {categories
              .filter((category) => category.isActive || category.id === item?.categoryId)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryLabel(category, categories)}
                  {category.isActive ? '' : ' (archived)'}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            name="trackInventory"
            type="checkbox"
            checked={track && type === 'PRODUCT'}
            disabled={type === 'SERVICE'}
            onChange={(event) => setTrack(event.target.checked)}
          />
          Track inventory
        </label>
      </div>
      {type === 'SERVICE' && (
        <p className="text-sm text-slate-500">Services do not track inventory.</p>
      )}
      {!item && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Default variant</h2>
          <PricingFields currency={currency} />
        </section>
      )}
      {fields.some((field) => field.isActive) && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Custom fields</h2>
          <CustomInputs fields={fields} item={item} />
        </section>
      )}
      {item && (
        <>
          <Active active={item.isActive} />
          <p className="text-sm text-slate-500">
            Uncheck Active to archive this item. Its variants and attributes are retained.
          </p>
        </>
      )}
      <Feedback state={state} pending={pending} label={item ? 'Save item' : 'Create item'} />
    </form>
  );
}
export function VariantForm({
  org,
  itemId,
  currency,
  options,
  variant,
}: {
  org: string;
  itemId: string;
  currency: string;
  options: CatalogOptionResponse[];
  variant?: CatalogVariantResponse;
}) {
  const [state, action, pending] = useActionState(
    saveVariant.bind(null, org, itemId, variant?.id ?? null),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <PricingFields currency={currency} variant={variant} />
      <div className="grid gap-4 sm:grid-cols-2">
        {options
          .filter((option) => option.isActive)
          .map((option) => (
            <label className="field" key={option.id}>
              {option.name}
              <select
                name="optionValueIds"
                defaultValue={
                  option.values.find((value) => variant?.optionValueIds.includes(value.id))?.id ??
                  ''
                }
              >
                <option value="">Not specified</option>
                {option.values
                  .filter((value) => value.isActive)
                  .map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.value}
                    </option>
                  ))}
              </select>
            </label>
          ))}
      </div>
      <Active
        name="variantActive"
        active={variant?.isActive ?? true}
        disabled={variant?.isDefault ?? false}
      />
      {variant?.isDefault && (
        <p className="text-sm text-slate-500">
          The default variant stays active. Archive the item to remove it from the active catalog.
        </p>
      )}
      <Feedback state={state} pending={pending} label={variant ? 'Save variant' : 'Add variant'} />
    </form>
  );
}
