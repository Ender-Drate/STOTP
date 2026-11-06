import { randomToken, sha256 } from "./crypto";
import { getDb, nowSec } from "./db";

export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const MAX_CHALLENGE_ATTEMPTS = 5;

export interface LoginChallenge {
  token_hash: string;
  user_id: number;
  expires_at: number;
  ttl_seconds: number;
  ip: string;
  attempts: number;
  used: number;
  created_at: number;
}

export function createChallenge(
  userId: number, ttlSeconds: number, ip: string
): { ticket: string; expiresIn: number } {
  const ticket = randomToken(32);
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO login_challenges(token_hash, user_id, expires_at, ttl_seconds, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sha256(ticket), userId, now + CHALLENGE_TTL_SECONDS, ttlSeconds, ip, now);
  getDb().prepare("DELETE FROM login_challenges WHERE expires_at < ?").run(now - 60);
  return { ticket, expiresIn: CHALLENGE_TTL_SECONDS };
}

export function getChallenge(ticket: string, ip: string): LoginChallenge | undefined {
  if (!ticket) return undefined;
  const row = getDb().prepare(
    "SELECT * FROM login_challenges WHERE token_hash = ?"
  ).get(sha256(ticket)) as unknown as LoginChallenge | undefined;
  if (!row) return undefined;
  if (row.used || row.expires_at < nowSec() || row.ip !== ip) return undefined;
  if (row.attempts >= MAX_CHALLENGE_ATTEMPTS) return undefined;
  return row;
}

export function markChallengeUsed(ticket: string): void {
  getDb().prepare("UPDATE login_challenges SET used = 1 WHERE token_hash = ?")
    .run(sha256(ticket));
}

export function failChallenge(ticket: string): number {
  getDb().prepare("UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?")
    .run(sha256(ticket));
  const row = getDb().prepare(
    "SELECT attempts FROM login_challenges WHERE token_hash = ?"
  ).get(sha256(ticket)) as { attempts: number } | undefined;
  return row?.attempts ?? MAX_CHALLENGE_ATTEMPTS;
}
