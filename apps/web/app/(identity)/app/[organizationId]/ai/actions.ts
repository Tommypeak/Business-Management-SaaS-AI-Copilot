'use server';
import type {
  AiConversationResponse,
  AiMessageResponse,
  AiSettingsResponse,
  AiStatusResponse,
  AiTurnResponse,
  PageResponse,
} from '@saas/types';
import { aiRequest } from '@/lib/ai';
const part = (s: string) => encodeURIComponent(s);
export async function createConversation(org: string) {
  return aiRequest<AiConversationResponse>(org, 'conversations', 'POST', {});
}
export async function listConversations(org: string, cursor?: string) {
  return aiRequest<PageResponse<AiConversationResponse>>(
    org,
    `conversations${cursor ? '?cursor=' + part(cursor) : ''}`,
  );
}
export async function readConversation(org: string, id: string, cursor?: string) {
  return aiRequest<PageResponse<AiMessageResponse>>(
    org,
    `conversations/${part(id)}${cursor ? '?cursor=' + part(cursor) : ''}`,
  );
}
export async function deleteConversation(org: string, id: string) {
  return aiRequest<{ deleted: boolean }>(org, `conversations/${part(id)}`, 'DELETE');
}
export async function sendMessage(
  org: string,
  id: string,
  clientMessageId: string,
  content: string,
) {
  return aiRequest<AiTurnResponse>(org, `conversations/${part(id)}/messages`, 'POST', {
    clientMessageId,
    content,
  });
}
export async function saveAiSettings(org: string, enabled: boolean) {
  return aiRequest<AiSettingsResponse>(org, 'settings', 'PATCH', {
    enabled,
    disclosureVersion: 'v1',
  });
}
export async function refreshAiStatus(org: string) {
  return aiRequest<AiStatusResponse>(org, 'status');
}
