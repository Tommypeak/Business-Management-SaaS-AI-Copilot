import Link from 'next/link';
import { api } from '../../../lib/api';
import { OrganizationForm } from './forms';

export default async function OrganizationsPage() {
  const organizations = await api.organizations();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {organizations.length ? 'Your organizations' : 'Create your organization'}
      </h1>
      {organizations.length > 0 && (
        <ul className="space-y-2">
          {organizations.map((organization) => (
            <li key={organization.id}>
              <Link className="underline" href={`/app/${organization.id}`}>
                {organization.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {organizations.length > 0 && <h2 className="text-xl">Create another organization</h2>}
      <OrganizationForm />
    </div>
  );
}
