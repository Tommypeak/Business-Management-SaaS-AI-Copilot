const text = { type: 'string' as const };
const uuid = { ...text, format: 'uuid' };
const date = { ...text, format: 'date-time' };
const bool = { type: 'boolean' as const };
const object = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});
const source = object(
  {
    tool: text,
    label: text,
    href: text,
    refreshedAt: date,
    from: { ...text, format: 'date' },
    to: { ...text, format: 'date' },
    locationId: uuid,
    currencyCode: text,
  },
  ['tool', 'label', 'href', 'refreshedAt'],
);
const message = object({
  id: uuid,
  clientMessageId: uuid,
  role: { ...text, enum: ['USER', 'ASSISTANT'] },
  content: text,
  status: { ...text, enum: ['PENDING', 'COMPLETED', 'FAILED'] },
  errorCode: { ...text, nullable: true },
  sources: { type: 'array', items: source },
  createdAt: date,
  restricted: bool,
});
const conversation = object({ id: uuid, title: text, createdAt: date, updatedAt: date });
export const aiSchemas = {
  conversation,
  conversations: object({
    items: { type: 'array', items: conversation },
    nextCursor: { ...uuid, nullable: true },
  }),
  history: object({
    conversation,
    items: { type: 'array', items: message },
    nextCursor: { ...uuid, nullable: true },
  }),
  turn: object({
    messages: { type: 'array', items: message },
    requestId: { ...uuid, nullable: true },
  }),
  settings: object({
    enabled: bool,
    disclosureVersion: { ...text, enum: ['v1'] },
    updatedAt: { ...date, nullable: true },
  }),
  deleted: object({ deleted: bool }),
  status: object({
    enabled: bool,
    available: bool,
    code: { ...text, nullable: true },
    provider: { ...text, nullable: true },
    model: { ...text, nullable: true },
    providerHost: { ...text, nullable: true },
    limits: object(
      Object.fromEntries(
        [
          'messageCharacters',
          'userRequestsPerHour',
          'organizationRequestsPerDay',
          'maxToolCalls',
          'maxToolRounds',
          'turnTimeoutMs',
        ].map((k) => [k, { type: 'integer', minimum: 1 }]),
      ),
    ),
  }),
};
