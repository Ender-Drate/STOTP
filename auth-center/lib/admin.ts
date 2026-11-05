import { currentUser } from "./session";
import { HttpError } from "./http";
import type { User } from "./db";

export async function requireAdmin(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "login_required", "请先登录");
  if (user.role !== "admin") throw new HttpError(403, "forbidden", "需要管理员权限");
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "login_required", "请先登录");
  return user;
}
