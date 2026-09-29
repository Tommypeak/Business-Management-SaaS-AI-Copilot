import { api } from '../../../../lib/api';

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const organization = await api.organization(organizationId);
  return (
    <section className="panel space-y-3">
      <h1 className="text-2xl font-semibold">{organization.name}</h1>
      <dl className="grid grid-cols-2 gap-3">
        <dt>Business type</dt>
        <dd>{organization.businessType}</dd>
        <dt>Currency</dt>
        <dd>{organization.defaultCurrency}</dd>
        <dt>Timezone</dt>
        <dd>{organization.timezone}</dd>
        <dt>Locale</dt>
        <dd>{organization.locale}</dd>
        <dt>Your roles</dt>
        <dd>
          {organization.currentMembership.roles.map((role) => role.name).join(', ') || 'None'}
        </dd>
      </dl>
    </section>
  );
}
