import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { catalogApi } from '../../../../../../lib/catalog';
import { FieldForm, FieldOptionForm } from '../management-forms';

export default async function FieldsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  const [organization, fields] = await Promise.all([api.organization(org), catalogApi.fields(org)]);
  const manage = organization.currentMembership.permissions.includes(Permission.CATALOG_MANAGE);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Custom fields</h2>
      <p className="text-sm text-slate-500">
        Active fields appear on item forms. Archiving preserves existing values. Key and type cannot
        change.
      </p>
      {manage && (
        <details className="panel space-y-4">
          <summary className="cursor-pointer font-semibold">Create custom field</summary>
          <FieldForm org={org} />
        </details>
      )}
      {fields.map((field) => (
        <article className="panel space-y-4" key={field.id}>
          <h3 className="font-semibold">{field.name}</h3>
          <p className="text-sm text-slate-500">
            {field.key} · {field.type} · {field.isRequired ? 'Required' : 'Optional'} ·{' '}
            {field.isActive ? 'Active' : 'Archived'}
          </p>
          {field.options.length > 0 && (
            <p className="text-sm">
              Options:{' '}
              {field.options
                .map((option) => `${option.label}${option.isActive ? '' : ' (archived)'}`)
                .join(', ')}
            </p>
          )}
          {manage && (
            <>
              <details className="space-y-4">
                <summary className="cursor-pointer underline">Edit field</summary>
                <FieldForm org={org} field={field} />
              </details>
              {field.isActive && field.type.includes('SELECT') && (
                <>
                  {field.options.map((option) => (
                    <details key={option.id} className="space-y-4">
                      <summary className="cursor-pointer underline">
                        Edit option: {option.label}
                      </summary>
                      <FieldOptionForm org={org} fieldId={field.id} option={option} />
                    </details>
                  ))}
                  <details className="space-y-4">
                    <summary className="cursor-pointer underline">Add option</summary>
                    <FieldOptionForm org={org} fieldId={field.id} />
                  </details>
                </>
              )}
            </>
          )}
        </article>
      ))}
      {!fields.length && <p className="panel text-slate-500">No custom fields yet.</p>}
    </div>
  );
}
