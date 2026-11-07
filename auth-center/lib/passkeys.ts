import { getDb, nowIso } from "./db";

export interface PasskeyRecord {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export function listPasskeys(userId: number): PasskeyRecord[] {
  return getDb().prepare(
    "SELECT * FROM passkeys WHERE user_id = ? ORDER BY id DESC"
  ).all(userId) as unknown as PasskeyRecord[];
}

export function findPasskeyByCredential(credentialId: string): PasskeyRecord | undefined {
  return getDb().prepare(
    "SELECT * FROM passkeys WHERE credential_id = ?"
  ).get(credentialId) as unknown as PasskeyRecord | undefined;
}

export function createPasskey(input: {
  userId: number;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
}): void {
  getDb().prepare(
    `INSERT INTO passkeys(user_id, credential_id, public_key, counter, transports, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(input.userId, input.credentialId, input.publicKey, input.counter,
    JSON.stringify(input.transports), input.name, nowIso());
}

export function touchPasskey(credentialId: string, counter: number): void {
  getDb().prepare(
    "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?"
  ).run(counter, nowIso(), credentialId);
}

export function deletePasskey(userId: number, id: number): boolean {
  const result = getDb().prepare(
    "DELETE FROM passkeys WHERE id = ? AND user_id = ?"
  ).run(id, userId);
  return Number(result.changes) > 0;
}

export function countPasskeys(userId: number): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM passkeys WHERE user_id = ?")
    .get(userId) as { c: number }).c;
}
