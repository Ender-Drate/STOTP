import { randomToken, sha256 } from "./crypto";
import { getDb, nowSec } from "./db";
import type { AccountRiskLevel } from "./account-risk";

const TTL = 30 * 60;

export interface PasswordResetRecord {
  token_hash: string;
  user_id: number;
  risk_level: AccountRiskLevel;
  expires_at: number;
  used: number;
  created_at: number;
}

export function issuePasswordReset(userId: number, risk: AccountRiskLevel): string {
  const token = randomToken(32);
  const now = nowSec();
  const db = getDb();
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
  db.prepare(
    `INSERT INTO password_reset_tokens(token_hash, user_id, risk_level, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sha256(token), userId, risk, now + TTL, now);
  db.prepare("DELETE FROM password_reset_tokens WHERE expires_at < ?").run(now - 60);
  return token;
}

export function peekPasswordReset(token: string): PasswordResetRecord | null {
  if (!token) return null;
  const row = getDb().prepare(
    `SELECT * FROM password_reset_tokens WHERE token_hash = ?`
  ).get(sha256(token)) as unknown as PasswordResetRecord | undefined;
  if (!row || row.used || row.expires_at < nowSec()) return null;
  return row;
}

/** 原子消费重置 token；返回 null 表示已被使用/过期。 */
export function consumePasswordReset(token: string): PasswordResetRecord | null {
  const row = peekPasswordReset(token);
  if (!row) return null;
  const result = getDb().prepare(
    "UPDATE password_reset_tokens SET used = 1 WHERE token_hash = ? AND used = 0"
  ).run(row.token_hash);
  return Number(result.changes) > 0 ? row : null;
}

export function clearPasswordResets(userId: number): void {
  getDb().prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
}
