import { getDb, nowSec } from "./db";

const TTL = 10 * 60;

export function savePendingTotp(userId: number, secret: string): void {
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO totp_pending(user_id, secret, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret,
       expires_at = excluded.expires_at, created_at = excluded.created_at`
  ).run(userId, secret, now + TTL, now);
}

export function getPendingTotp(userId: number): string | null {
  const db = getDb();
  db.prepare("DELETE FROM totp_pending WHERE expires_at < ?").run(nowSec());
  const row = db.prepare("SELECT secret FROM totp_pending WHERE user_id = ?")
    .get(userId) as { secret: string } | undefined;
  return row?.secret ?? null;
}

export function clearPendingTotp(userId: number): void {
  getDb().prepare("DELETE FROM totp_pending WHERE user_id = ?").run(userId);
}
