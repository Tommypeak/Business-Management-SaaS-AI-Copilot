'use client';

import { useActionState } from 'react';
import {
  BUSINESS_TYPES,
  LOCATION_TYPES,
  type OrganizationResponse,
  type LocationResponse,
} from '@saas/types';
import { saveOrganization, saveLocation, type FormState } from './actions';

function Feedback({ state }: { state: FormState }) {
  return (
    <div aria-live="polite">
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-green-800">{state.success}</p>}
    </div>
  );
}

export function OrganizationForm({ organization }: { organization?: OrganizationResponse }) {
  const [state, action, pending] = useActionState(
    saveOrganization.bind(null, organization?.id ?? null),
    {},
  );
  return (
    <form action={action} className="panel space-y-4">
      <label className="field">
        Organization name
        <input name="name" required maxLength={120} defaultValue={organization?.name} />
      </label>
      <label className="field">
        Business type
        <select name="businessType" defaultValue={organization?.businessType ?? 'OTHER'}>
          {BUSINESS_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Currency (ISO 4217)
        <input
          name="defaultCurrency"
          required
          minLength={3}
          maxLength={3}
          pattern="[A-Za-z]{3}"
          defaultValue={organization?.defaultCurrency ?? 'USD'}
        />
      </label>
      <label className="field">
        Timezone (IANA)
        <input
          name="timezone"
          required
          maxLength={100}
          defaultValue={organization?.timezone ?? 'UTC'}
          placeholder="Asia/Almaty"
        />
      </label>
      <label className="field">
        Locale
        <input
          name="locale"
          required
          maxLength={35}
          defaultValue={organization?.locale ?? 'en'}
          placeholder="en-US"
        />
      </label>
      <Feedback state={state} />
      <button className="button" disabled={pending}>
        {pending ? 'Saving…' : organization ? 'Save organization' : 'Create organization'}
      </button>
    </form>
  );
}

export function LocationForm({
  organizationId,
  location,
}: {
  organizationId: string;
  location?: LocationResponse;
}) {
  const [state, action, pending] = useActionState(
    saveLocation.bind(null, organizationId, location?.id ?? null),
    {},
  );
  return (
    <form action={action} className="panel space-y-4">
      <label className="field">
        Location name
        <input name="name" required maxLength={120} defaultValue={location?.name} />
      </label>
      <label className="field">
        Type
        <select name="type" defaultValue={location?.type ?? 'OTHER'}>
          {LOCATION_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="isActive" defaultChecked={location?.isActive ?? true} />
        Active
      </label>
      <Feedback state={state} />
      <button className="button" disabled={pending}>
        {pending ? 'Saving…' : location ? 'Save location' : 'Create location'}
      </button>
    </form>
  );
}
