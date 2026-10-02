import { Permission, type PermissionCode } from '@saas/types';
export { Permission };
export const ALL_PERMISSIONS = Object.values(Permission);
export function isPermission(value: string): value is PermissionCode {
  return ALL_PERMISSIONS.some((permission) => permission === value);
}
export const SYSTEM_ROLES = [
  { key: 'OWNER', name: 'Owner', permissions: ALL_PERMISSIONS },
  // Role/membership mutations are reserved for owners when introduced later.
  {
    key: 'ADMIN',
    name: 'Administrator',
    permissions: ALL_PERMISSIONS.filter(
      (permission) =>
        permission !== Permission.ROLES_MANAGE && permission !== Permission.MEMBERS_MANAGE,
    ),
  },
  {
    key: 'MEMBER',
    name: 'Member',
    permissions: [
      Permission.ORGANIZATION_VIEW,
      Permission.LOCATIONS_VIEW,
      Permission.CATALOG_VIEW,
      Permission.INVENTORY_VIEW,
      Permission.SALES_VIEW,
      Permission.CUSTOMERS_VIEW,
    ],
  },
] as const;
