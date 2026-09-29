'use client';
import { useActionState, useState } from 'react';
import {
  CUSTOM_FIELD_TYPES,
  type CatalogCategoryResponse,
  type CatalogOptionResponse,
  type CatalogOptionValueResponse,
  type CustomFieldDefinitionResponse,
  type CustomFieldOptionResponse,
} from '@saas/types';
import { saveCategory, saveField, saveFieldOption, saveOption, saveOptionValue } from './actions';
import { Active, Feedback } from './form-controls';
import { categoryLabel } from './presentation';

export function CategoryForm({
  org,
  categories,
  category,
}: {
  org: string;
  categories: CatalogCategoryResponse[];
  category?: CatalogCategoryResponse;
}) {
  const [state, action, pending] = useActionState(
    saveCategory.bind(null, org, category?.id ?? null),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <label className="field">
        Name
        <input name="name" required maxLength={120} defaultValue={category?.name} />
      </label>
      <label className="field">
        Parent
        <select name="parentId" defaultValue={category?.parentId ?? ''}>
          <option value="">Root category</option>
          {categories
            .filter(
              (entry) =>
                entry.id !== category?.id && (entry.isActive || entry.id === category?.parentId),
            )
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {categoryLabel(entry, categories)}
                {entry.isActive ? '' : ' (archived)'}
              </option>
            ))}
        </select>
      </label>
      <Active active={category?.isActive ?? true} />
      <Feedback
        state={state}
        pending={pending}
        label={category ? 'Save category' : 'Create category'}
      />
    </form>
  );
}
export function FieldForm({ org, field }: { org: string; field?: CustomFieldDefinitionResponse }) {
  const [state, action, pending] = useActionState(saveField.bind(null, org, field?.id ?? null), {});
  const [type, setType] = useState<string>(field?.type ?? 'TEXT');
  return (
    <form action={action} className="space-y-4">
      <label className="field">
        Name
        <input name="name" required maxLength={120} defaultValue={field?.name} />
      </label>
      {!field && (
        <>
          <label className="field">
            Stable key
            <input
              name="key"
              required
              pattern="[a-z][a-z0-9_]{0,63}"
              maxLength={64}
              placeholder="roast_level"
            />
          </label>
          <label className="field">
            Type
            <select name="type" value={type} onChange={(event) => setType(event.target.value)}>
              {CUSTOM_FIELD_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          {type.includes('SELECT') && (
            <label className="field">
              Options
              <textarea
                name="options"
                rows={4}
                required
                maxLength={8100}
                placeholder={'One option per line\nMaximum 80 characters per option'}
              />
            </label>
          )}
        </>
      )}
      {field && (
        <p className="text-sm text-slate-500">
          {field.key} · {field.type} · Key and type are stable.
        </p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="isRequired" defaultChecked={field?.isRequired ?? false} />
        Required for active catalog items
      </label>
      <p className="text-sm text-slate-500">
        For an existing catalog, create an optional field, populate it on active items, then mark it
        required.
      </p>
      {field && <Active active={field.isActive} />}
      <Feedback state={state} pending={pending} label={field ? 'Save field' : 'Create field'} />
    </form>
  );
}
function Position({ value = 0 }: { value?: number }) {
  return (
    <label className="field">
      Position
      <input name="position" type="number" min={0} max={10000} step={1} defaultValue={value} />
    </label>
  );
}
export function FieldOptionForm({
  org,
  fieldId,
  option,
}: {
  org: string;
  fieldId: string;
  option?: CustomFieldOptionResponse;
}) {
  const [state, action, pending] = useActionState(
    saveFieldOption.bind(null, org, fieldId, option?.id ?? null),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <label className="field">
        Label
        <input name="label" required maxLength={120} defaultValue={option?.label} />
      </label>
      {!option && (
        <label className="field">
          Stable value
          <input name="value" required maxLength={80} />
        </label>
      )}
      <Position value={option?.position} />
      <Active active={option?.isActive ?? true} />
      <Feedback state={state} pending={pending} label={option ? 'Save option' : 'Add option'} />
    </form>
  );
}
export function OptionForm({
  org,
  itemId,
  option,
}: {
  org: string;
  itemId: string;
  option?: CatalogOptionResponse;
}) {
  const [state, action, pending] = useActionState(
    saveOption.bind(null, org, itemId, option?.id ?? null),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <label className="field">
        Option name
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={option?.name}
          placeholder="Color or Size"
        />
      </label>
      <Position value={option?.position} />
      <Active active={option?.isActive ?? true} />
      <Feedback
        state={state}
        pending={pending}
        label={option ? 'Save option' : 'Add variant option'}
      />
    </form>
  );
}
export function OptionValueForm({
  org,
  itemId,
  optionId,
  value,
}: {
  org: string;
  itemId: string;
  optionId: string;
  value?: CatalogOptionValueResponse;
}) {
  const [state, action, pending] = useActionState(
    saveOptionValue.bind(null, org, itemId, optionId, value?.id ?? null),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <label className="field">
        Value
        <input
          name="value"
          required
          maxLength={80}
          defaultValue={value?.value}
          placeholder="Black or Medium"
        />
      </label>
      <Position value={value?.position} />
      <Active active={value?.isActive ?? true} />
      <Feedback state={state} pending={pending} label={value ? 'Save value' : 'Add value'} />
    </form>
  );
}
