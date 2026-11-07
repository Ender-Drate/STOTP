import { randomToken, sha256 } from "./crypto";
import { getDb, nowSec } from "./db";

const TTL = 24 * 3600;

export function issueEmailVerification(userId: number): string {
  const token = randomToken(32);
  const now = nowSec();
  const db = getDb();
  db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
  db.prepare(
    `INSERT INTO email_verification_tokens(token_hash, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(sha256(token), userId, now + TTL, now);
  db.prepare("DELETE FROM email_verification_tokens WHERE expires_at < ?").run(now - 60);
  return token;
}

/** 消费一次性邮箱验证 token，返回 user_id。 */
export function consumeEmailVerification(token: string): number | null {
  if (!token) return null;
  const db = getDb();
  const hash = sha256(token);
  const row = db.prepare(
    "SELECT user_id, expires_at, used FROM email_verification_tokens WHERE token_hash = ?"
  ).get(hash) as { user_id: number; expires_at: number; used: number } | undefined;
  if (!row || row.used || row.expires_at < nowSec()) return null;
  const result = db.prepare(
    "UPDATE email_verification_tokens SET used = 1 WHERE token_hash = ? AND used = 0"
  ).run(hash);
  if (Number(result.changes) === 0) return null;
  return row.user_id;
}

export function clearEmailVerification(userId: number): void {
  getDb().prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
}
