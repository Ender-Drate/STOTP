import { getDb, nowIso, type StotpBinding } from "./db";

export function getBinding(userId: number): StotpBinding | undefined {
  return getDb().prepare(
    "SELECT * FROM stotp_bindings WHERE user_id = ? AND status = 'active'"
  ).get(userId) as unknown as StotpBinding | undefined;
}

export function getBindingByClientId(clientId: string): StotpBinding | undefined {
  return getDb().prepare(
    "SELECT * FROM stotp_bindings WHERE client_id = ?"
  ).get(clientId) as unknown as StotpBinding | undefined;
}

export function saveBinding(
  userId: number, clientId: string, accountId: string | null
): StotpBinding {
  const now = nowIso();
  getDb().prepare(
    `INSERT INTO stotp_bindings(user_id, client_id, account_id, status, created_at, last_verified_at)
     VALUES (?, ?, ?, 'active', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       client_id = excluded.client_id,
       account_id = excluded.account_id,
       status = 'active',
       last_verified_at = excluded.last_verified_at`
  ).run(userId, clientId, accountId, now, now);
  return getBinding(userId)!;
}

export function touchBinding(userId: number): void {
  getDb().prepare("UPDATE stotp_bindings SET last_verified_at = ? WHERE user_id = ?")
    .run(nowIso(), userId);
}

export function removeBinding(userId: number): boolean {
  const result = getDb().prepare("DELETE FROM stotp_bindings WHERE user_id = ?")
    .run(userId);
  return Number(result.changes) > 0;
}

export function bindingView(binding: StotpBinding) {
  return {
    clientId: binding.client_id,
    accountId: binding.account_id,
    status: binding.status,
    createdAt: binding.created_at,
    lastVerifiedAt: binding.last_verified_at,
  };
}
