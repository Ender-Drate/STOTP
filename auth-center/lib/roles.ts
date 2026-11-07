import { randomBytes } from "node:crypto";
import { getDb, nowIso, type RoleRecord } from "./db";

export interface RoleView extends RoleRecord {
  permissionsList: string[];
  userCount: number;
}

export function parseRolePermissions(role: RoleRecord): string[] {
  try {
    const parsed = JSON.parse(role.permissions) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function roleView(role: RoleRecord): RoleView {
  const count = getDb().prepare(
    "SELECT COUNT(*) AS c FROM users WHERE role_id = ?"
  ).get(role.id) as { c: number };
  return {
    ...role,
    permissionsList: parseRolePermissions(role),
    userCount: count.c,
  };
}

export function getRole(id: number): RoleRecord | undefined {
  return getDb().prepare("SELECT * FROM roles WHERE id = ?")
    .get(id) as unknown as RoleRecord | undefined;
}

export function getRoleByKey(key: string): RoleRecord | undefined {
  return getDb().prepare("SELECT * FROM roles WHERE key = ?")
    .get(key) as unknown as RoleRecord | undefined;
}

export function listRoles(): RoleView[] {
  const rows = getDb().prepare(
    `SELECT roles.*,
       (SELECT COUNT(*) FROM users WHERE users.role_id = roles.id) AS user_count
     FROM roles ORDER BY roles.is_system DESC, roles.id ASC`
  ).all() as unknown as Array<RoleRecord & { user_count: number }>;
  return rows.map((row) => ({
    ...row,
    permissionsList: parseRolePermissions(row),
    userCount: row.user_count,
  }));
}

export function createRole(
  name: string, description: string, permissions: string[]
): RoleRecord {
  const key = `role_${randomBytes(5).toString("hex")}`;
  const result = getDb().prepare(
    `INSERT INTO roles(key, name, description, permissions, is_system, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(key, name, description, JSON.stringify(permissions), nowIso());
  return getRole(Number(result.lastInsertRowid))!;
}

export function updateRole(
  id: number, name: string, description: string, permissions: string[]
): void {
  getDb().prepare(
    "UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?"
  ).run(name, description, JSON.stringify(permissions), id);
}

export function deleteRole(id: number): boolean {
  const result = getDb().prepare(
    "DELETE FROM roles WHERE id = ? AND is_system = 0"
  ).run(id);
  return Number(result.changes) > 0;
}

export function countUsersWithRole(id: number): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE role_id = ?")
    .get(id) as { c: number }).c;
}
