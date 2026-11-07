import { currentUser } from "./session";
import { HttpError } from "./http";
import type { User } from "./db";
import { hasPermission, isSuperAdmin } from "./permissions";

export async function requireAdmin(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "login_required", "请先登录");
  if (!hasPermission(user, "admin.access")) {
    throw new HttpError(403, "forbidden", "需要管理员权限");
  }
  return user;
}

export async function requirePermission(permission: string): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "login_required", "请先登录");
  if (!hasPermission(user, permission)) {
    throw new HttpError(403, "forbidden", "没有该操作的权限");
  }
  return user;
}

export async function requireSuperAdmin(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "login_required", "请先登录");
  if (!isSuperAdmin(user)) {
    throw new HttpError(403, "forbidden", "只有最高管理员可以管理权限等级");
  }
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "login_required", "请先登录");
  return user;
}
