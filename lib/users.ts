import type { User } from "./db";
import { permissionsOf, roleNameOf } from "./permissions";

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    roleName: roleNameOf(user),
    status: user.status,
    permissions: permissionsOf(user),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}
