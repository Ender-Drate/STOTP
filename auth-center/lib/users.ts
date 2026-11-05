import type { User } from "./db";

export function publicUser(user: User) {
  let permissions: string[] = [];
  try {
    permissions = JSON.parse(user.permissions) as string[];
  } catch {
    permissions = [];
  }
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    status: user.status,
    permissions,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}
