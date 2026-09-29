import { Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { LocationForm } from '../../forms';

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const organization = await api.organization(organizationId);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.LOCATIONS_VIEW))
    return <p role="alert">You do not have permission to view locations.</p>;
  const locations = await api.locations(organizationId);
  const canManage = permissions.includes(Permission.LOCATIONS_MANAGE);
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold">Locations</h1>
      {canManage && (
        <div className="space-y-3">
          <h2 className="text-xl">New location</h2>
          <LocationForm organizationId={organizationId} />
        </div>
      )}
      {!locations.length && <p>No locations yet.</p>}
      {locations.map((location) =>
        canManage ? (
          <LocationForm
            key={`${location.id}:${location.updatedAt}`}
            organizationId={organizationId}
            location={location}
          />
        ) : (
          <article className="panel" key={location.id}>
            <h2 className="font-semibold">{location.name}</h2>
            <p>
              {location.type} · {location.isActive ? 'Active' : 'Archived'}
            </p>
          </article>
        ),
      )}
    </section>
  );
}
