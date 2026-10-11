import { Permission, type AiSettingsResponse } from '@saas/types';
import { api } from '@/lib/api';
import { aiRequest } from '@/lib/ai';
import { AiSettings } from '@/components/ai/settings';
export default async function AiSettingsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organizationContext(org);
  if (!organization.permissions.includes(Permission.AI_MANAGE))
    return (
      <section className="panel">
        <h1>AI Settings</h1>
        <p>Only members with ai.manage can change AI settings.</p>
      </section>
    );
  return <AiSettings org={org} initial={await aiRequest<AiSettingsResponse>(org, 'settings')} />;
}
