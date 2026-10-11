export const aiErrors: Record<string, string> = {
  AI_DISABLED: 'Copilot is disabled. An organization owner can enable it in AI Settings.',
  AI_PROVIDER_NOT_CONFIGURED:
    'The AI provider is not configured. Ask your administrator to configure the server API key and internal service connection.',
  AI_SERVICE_UNAVAILABLE: 'The AI service is unavailable. Please try again later.',
  AI_PROVIDER_UNAVAILABLE: 'The model provider is unavailable. Please try again later.',
  AI_PROVIDER_TIMEOUT: 'The model provider timed out. You can retry this message.',
  AI_TURN_TIMEOUT: 'This request reached its time limit. Try a narrower question.',
  AI_PROVIDER_RATE_LIMIT: 'The model provider has reached its rate limit. Please retry later.',
  AI_RATE_LIMITED:
    'Your hourly or organization daily AI limit has been reached. Please retry after the limit resets.',
  AI_RATE_LIMIT_UNAVAILABLE: 'Usage limits could not be checked. Please retry later.',
  AI_CONVERSATION_BUSY:
    'A reply is already being generated in this conversation. Wait for it to finish.',
  AI_PERMISSION_DENIED:
    'Your current permissions do not allow this question. Ask your organization owner for access.',
  AI_ACCESS_DENIED: 'Your access changed or this resource is unavailable.',
  AI_HISTORY_RESTRICTED: 'This message is unavailable with your current permissions.',
  AI_CONVERSATION_NOT_FOUND: 'This conversation is unavailable.',
  AI_CONTEXT_TOO_LARGE:
    'This question and its data exceed the context limit. Start a new conversation or use a shorter period.',
  AI_TOOL_RESULT_TOO_LARGE:
    'This result is too large. Ask for a shorter period or weekly/monthly grouping.',
  AI_TOOL_LIMIT: 'This question required too many data requests. Try one business topic at a time.',
  AI_UNKNOWN_TOOL: 'The model requested an unsupported operation. No operation was performed.',
  AI_INVALID_TOOL_ARGUMENTS:
    'The model requested invalid filters. Try a more specific period, location or item.',
  AI_MODEL_REFUSAL: 'The model could not answer this request. Try rephrasing it.',
  AI_MALFORMED_RESPONSE: 'The model returned an invalid response. You can retry.',
  AI_OUTPUT_LIMIT: 'The model reached its output limit. Try a shorter question.',
  AI_PROVIDER_INCOMPATIBLE:
    'The configured provider or model rejected this structured tool request. Ask your administrator to check compatibility.',
  AI_ANALYTICS_UNAVAILABLE: 'Business data could not be loaded. Please retry later.',
  AI_IDEMPOTENCY_CONFLICT:
    'This retry does not match the original message. Send it as a new message.',
  AI_RETRY_NOT_LATEST:
    'Only the latest failed message can be retried. Send your question as a new message.',
  AI_CONVERSATION_LIMIT: 'This conversation reached its message limit. Start a new conversation.',
  FINANCE_MIXED_CURRENCY:
    'These records use multiple currencies. Currency conversion is not available.',
  AP_MIXED_CURRENCY: 'Payables use multiple currencies. Currency conversion is not available.',
};
export const aiErrorText = (code: string | null) =>
  aiErrors[code ?? ''] ?? 'The request could not be completed. Please try again.';
