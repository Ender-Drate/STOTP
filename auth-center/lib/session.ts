import { cookies } from "next/headers";
import { PUBLIC_URL, SESSION_COOKIE } from "./config";
import { getDb, findUserById, nowSec, type User } from "./db";
import { randomToken, sha256 } from "./crypto";

export interface SessionRecord {
  id: string;
  user_id: number;
  expires_at: number;
  created_at: number;
  ip: string | null;
  user_agent: string | null;
  last_seen_at: number | null;
}

export async function currentSessionId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? sha256(token) : null;
}

export async function currentUser(): Promise<User | null> {
  const id = await currentSessionId();
  if (!id) return null;
  const row = getDb()
    .prepare("SELECT user_id, expires_at, last_seen_at FROM sessions WHERE id = ?")
    .get(id) as { user_id: number; expires_at: number; last_seen_at: number | null } | undefined;
  if (!row) return null;
  if (row.expires_at < nowSec()) {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  const now = nowSec();
  if (!row.last_seen_at || now - row.last_seen_at > 300) {
    getDb().prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, id);
  }
  const user = findUserById(row.user_id);
  return user && user.status === "active" ? user : null;
}

export function createSession(
  userId: number,
  ttlSeconds: number,
  meta?: { ip?: string; userAgent?: string },
): string {
  const token = randomToken(32);
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO sessions(id, user_id, expires_at, created_at, ip, user_agent, last_seen_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(sha256(token), userId, now + ttlSeconds, now,
    meta?.ip || null, meta?.userAgent?.slice(0, 500) || null, now);
  return token;
}

export function destroySession(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

export function listUserSessions(userId: number): SessionRecord[] {
  return getDb().prepare(
    `SELECT * FROM sessions WHERE user_id = ? AND expires_at > ?
     ORDER BY last_seen_at DESC, created_at DESC`
  ).all(userId, nowSec()) as unknown as SessionRecord[];
}

export function revokeSession(userId: number, id: string): boolean {
  const result = getDb().prepare(
    "DELETE FROM sessions WHERE id = ? AND user_id = ?"
  ).run(id, userId);
  return Number(result.changes) > 0;
}

export function revokeOtherSessions(userId: number, keepId: string | null): number {
  const result = getDb().prepare(
    "DELETE FROM sessions WHERE user_id = ? AND id != ?"
  ).run(userId, keepId || "");
  return Number(result.changes);
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
