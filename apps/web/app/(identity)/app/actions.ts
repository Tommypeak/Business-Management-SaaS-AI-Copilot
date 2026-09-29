'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { BUSINESS_TYPES, LOCATION_TYPES, type OrganizationInput } from '@saas/types';
import { api, ApiError } from '../../../lib/api';

export interface FormState {
  error?: string;
  success?: string;
}
const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

function organizationInput(form: FormData): OrganizationInput | undefined {
  const businessType = BUSINESS_TYPES.find((type) => type === text(form, 'businessType'));
  if (!businessType) return undefined;
  return {
    name: text(form, 'name'),
    businessType,
    defaultCurrency: text(form, 'defaultCurrency').toUpperCase(),
    timezone: text(form, 'timezone'),
    locale: text(form, 'locale') || 'en',
  };
}

export async function saveOrganization(
  organizationId: string | null,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const input = organizationInput(form);
  if (!input) return { error: 'Choose a business type.' };
  let id: string;
  try {
    const organization = organizationId
      ? await api.updateOrganization(organizationId, input)
      : await api.createOrganization(input);
    id = organization.id;
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  revalidatePath('/app', 'layout');
  if (!organizationId) redirect(`/app/${id}`);
  return { success: 'Organization saved.' };
}

export async function saveLocation(
  organizationId: string,
  locationId: string | null,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const type = LOCATION_TYPES.find((value) => value === text(form, 'type'));
  if (!type) return { error: 'Choose a location type.' };
  const input = { name: text(form, 'name'), type, isActive: form.get('isActive') === 'on' };
  try {
    if (locationId) await api.updateLocation(organizationId, locationId, input);
    else await api.createLocation(organizationId, input);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/app/${organizationId}/locations`);
  return { success: locationId ? 'Location saved.' : 'Location created.' };
}
