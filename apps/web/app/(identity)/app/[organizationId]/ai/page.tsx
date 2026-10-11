import {
  Permission,
  type AiStatusResponse,
  type AiConversationResponse,
  type PageResponse,
} from '@saas/types';
import { api } from '@/lib/api';
import { aiRequest } from '@/lib/ai';
import { AiChat } from '@/components/ai/chat';
export default async function AiPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId: org } = await params;
  const organization = await api.organizationContext(org);
  const permissions = organization.permissions;
  if (!permissions.includes(Permission.AI_USE))
    return (
      <section className="panel">
        <h1>AI Copilot</h1>
        <p>You do not have permission to use Copilot.</p>
      </section>
    );
  const [status, conversations] = await Promise.all([
    aiRequest<AiStatusResponse>(org, 'status'),
    aiRequest<PageResponse<AiConversationResponse>>(org, 'conversations'),
  ]);
  return (
    <AiChat
      key={org}
      org={org}
      permissions={permissions}
      initialStatus={status}
      initialConversations={conversations}
    />
  );
}
