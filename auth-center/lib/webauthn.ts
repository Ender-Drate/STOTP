import { randomToken, sha256 } from "./crypto";
import { PUBLIC_URL } from "./config";
import { getDb, nowSec } from "./db";

export const WEBAUTHN_COOKIE = "ac_webauthn";
export const WEBAUTHN_CHALLENGE_TTL = 5 * 60;

const url = new URL(PUBLIC_URL);
export const RP_ID = url.hostname;
export const RP_ORIGIN = url.origin;
export const RP_NAME = "STOTP 账户";

export function webauthnCookieOptions(maxAge = WEBAUTHN_CHALLENGE_TTL) {
  return {
    name: WEBAUTHN_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: PUBLIC_URL.startsWith("https://"),
    path: "/",
    maxAge,
  };
}

export type WebauthnType = "register" | "authenticate";

export interface WebauthnChallenge {
  token_hash: string;
  challenge: string;
  user_id: number | null;
  type: WebauthnType;
  ip: string;
  expires_at: number;
  used: number;
  created_at: number;
}

export function createWebauthnChallenge(
  challenge: string, type: WebauthnType, userId: number | null, ip: string
): { ticket: string; expiresIn: number } {
  const ticket = randomToken(32);
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO webauthn_challenges(token_hash, challenge, user_id, type, ip, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sha256(ticket), challenge, userId, type, ip,
    now + WEBAUTHN_CHALLENGE_TTL, now);
  getDb().prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").run(now - 60);
  return { ticket, expiresIn: WEBAUTHN_CHALLENGE_TTL };
}

export function consumeWebauthnChallenge(
  ticket: string, type: WebauthnType, ip: string
): WebauthnChallenge | undefined {
  if (!ticket) return undefined;
  const row = getDb().prepare(
    "SELECT * FROM webauthn_challenges WHERE token_hash = ?"
  ).get(sha256(ticket)) as unknown as WebauthnChallenge | undefined;
  if (!row || row.used || row.type !== type || row.expires_at < nowSec() || row.ip !== ip) {
    return undefined;
  }
  getDb().prepare("UPDATE webauthn_challenges SET used = 1 WHERE token_hash = ?")
    .run(sha256(ticket));
  return row;
}
