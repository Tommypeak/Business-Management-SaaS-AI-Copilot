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
  ORGANIZATION_VIEW: 'organization.view',
  ORGANIZATION_UPDATE: 'organization.update',
  MEMBERS_VIEW: 'members.view',
  MEMBERS_MANAGE: 'members.manage',
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',
  LOCATIONS_VIEW: 'locations.view',
  LOCATIONS_MANAGE: 'locations.manage',
} as const;
export type PermissionCode = (typeof Permission)[keyof typeof Permission];

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
