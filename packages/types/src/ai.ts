export interface AiSource {
  tool: string;
  label: string;
  href: string;
  refreshedAt: string;
  from?: string;
  to?: string;
  locationId?: string;
  currencyCode?: string;
}
export interface AiMessageResponse {
  id: string;
  clientMessageId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  errorCode: string | null;
  sources: AiSource[];
  createdAt: string;
  restricted: boolean;
}
export interface AiConversationResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
export interface AiStatusResponse {
  enabled: boolean;
  available: boolean;
  code: string | null;
  provider: string | null;
  model: string | null;
  providerHost: string | null;
  limits: {
    messageCharacters: number;
    userRequestsPerHour: number;
    organizationRequestsPerDay: number;
    maxToolCalls: number;
    maxToolRounds: number;
    turnTimeoutMs: number;
  };
}
export interface AiSettingsResponse {
  enabled: boolean;
  disclosureVersion: string;
  updatedAt: string | null;
}
export interface AiTurnResponse {
  messages: AiMessageResponse[];
  requestId: string | null;
}
