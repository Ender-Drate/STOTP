import type { User, RoleRecord } from "./db";
import { ALL_PERMISSION_KEYS } from "./permission-defs";
import { getRole, getRoleByKey, parseRolePermissions } from "./roles";

export function roleOf(user: User): RoleRecord | undefined {
  if (user.role_id) return getRole(user.role_id);
  return getRoleByKey(user.role);
}

export function isSuperAdmin(user: User): boolean {
  return roleOf(user)?.key === "superadmin";
}

export function permissionsOf(user: User): string[] {
  const role = roleOf(user);
  if (!role) return [];
  if (role.key === "superadmin") return [...ALL_PERMISSION_KEYS];
  return parseRolePermissions(role);
}

export function hasPermission(user: User, permission: string): boolean {
  return permissionsOf(user).includes(permission);
}

export function roleNameOf(user: User): string {
  return roleOf(user)?.name || user.role;
}
