/** Public liveness response; intentionally contains no business models. */
export interface HealthResponse {
  status: 'ok';
  service: 'web' | 'api' | 'ai';
}

export const BUSINESS_TYPES = [
  'RETAIL',
  'SERVICES',
  'WHOLESALE',
  'FOOD_SERVICE',
  'MIXED',
  'OTHER',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const LOCATION_TYPES = ['STORE', 'WAREHOUSE', 'OFFICE', 'SERVICE_POINT', 'OTHER'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/** Public permission names only. Authorization is always evaluated by the API. */
export const Permission = {
  RETURNS_VIEW: 'returns.view',
  RETURNS_MANAGE: 'returns.manage',
  REFUNDS_MANAGE: 'refunds.manage',
  AI_USE: 'ai.use',
  AI_MANAGE: 'ai.manage',
  ANALYTICS_VIEW: 'analytics.view',
  ACCOUNTS_PAYABLE_VIEW: 'accountsPayable.view',
  ACCOUNTS_PAYABLE_MANAGE: 'accountsPayable.manage',
  ACCOUNTS_PAYABLE_PAYMENTS_MANAGE: 'accountsPayable.payments.manage',
  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_MANAGE: 'expenses.manage',
  FINANCE_VIEW: 'finance.view',
  SUPPLIERS_VIEW: 'suppliers.view',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  PURCHASING_VIEW: 'purchasing.view',
  PURCHASING_CREATE: 'purchasing.create',
  PURCHASING_MANAGE: 'purchasing.manage',
  PURCHASING_RECEIVE: 'purchasing.receive',
  SALES_VIEW: 'sales.view',
  SALES_CREATE: 'sales.create',
  SALES_MANAGE: 'sales.manage',
  SALES_COMPLETE: 'sales.complete',
  SALES_PAYMENTS_MANAGE: 'sales.payments.manage',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  ORGANIZATION_VIEW: 'organization.view',
  ORGANIZATION_UPDATE: 'organization.update',
  MEMBERS_VIEW: 'members.view',
  MEMBERS_MANAGE: 'members.manage',
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',
  LOCATIONS_VIEW: 'locations.view',
  LOCATIONS_MANAGE: 'locations.manage',
  CATALOG_VIEW: 'catalog.view',
  CATALOG_MANAGE: 'catalog.manage',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_TRANSFER: 'inventory.transfer',
  INVENTORY_SETTINGS_MANAGE: 'inventory.settings.manage',
} as const;
export type PermissionCode = (typeof Permission)[keyof typeof Permission];
export * from './returns.js';
export * from './inventory.js';

export interface UserResponse {
  id: string;
  createdAt: string;
}
export interface RoleSummary {
  id: string;
  key: string;
  name: string;
}
export interface RoleResponse extends RoleSummary {
  isSystem: boolean;
  permissions: PermissionCode[];
}
export interface MembershipResponse {
  id: string;
  userId: string;
  status: 'ACTIVE' | 'SUSPENDED';
  roles: RoleSummary[];
}
export interface OrganizationInput {
  name: string;
  businessType: BusinessType;
  defaultCurrency: string;
  timezone: string;
  locale?: string;
}
export interface OrganizationResponse extends OrganizationInput {
  id: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
}
export interface OrganizationDetailResponse extends OrganizationResponse {
  currentMembership: { id: string; roles: RoleSummary[]; permissions: PermissionCode[] };
}
export interface LocationInput {
  name: string;
  type: LocationType;
  isActive?: boolean;
}
export interface LocationResponse extends LocationInput {
  id: string;
  organizationId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface PageResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export * from './catalog.js';
export * from './sales.js';
export * from './purchasing.js';
export * from './expenses.js';
export * from './accounts-payable.js';
export * from './analytics.js';
export * from './ai.js';
