import { cookies } from "next/headers";
import { PUBLIC_URL, SESSION_COOKIE } from "./config";
import { getDb, findUserById, nowSec, type User } from "./db";
import { randomToken, sha256 } from "./crypto";

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
    .get(sha256(token)) as { user_id: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < nowSec()) {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
    return null;
  }
  const user = findUserById(row.user_id);
  return user && user.status === "active" ? user : null;
}

export function createSession(userId: number, ttlSeconds: number): string {
  const token = randomToken(32);
  const now = nowSec();
  getDb().prepare(
    "INSERT INTO sessions(id, user_id, expires_at, created_at) VALUES (?,?,?,?)"
  ).run(sha256(token), userId, now + ttlSeconds, now);
  return token;
}

export function destroySession(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

export function sessionCookieOptions(maxAge: number) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    // 只有对外地址是 https 时才加 Secure，便于局域网 http 部署
    secure: PUBLIC_URL.startsWith("https://"),
    path: "/",
    maxAge,
  };
}
