import { getDb, nowIso } from "./db";
import { normalizeIp } from "./ip";

export interface IpRule {
  id: number;
  ip: string;
  action: "watch" | "block";
  reason: string | null;
  created_by: number | null;
  created_at: string;
  expires_at: string | null;
}

export function listIpRules(): IpRule[] {
  return getDb().prepare(
    "SELECT * FROM ip_rules ORDER BY id DESC"
  ).all() as unknown as IpRule[];
}

export function getIpRule(ip: string): IpRule | undefined {
  const normalized = normalizeIp(ip);
  if (!normalized) return undefined;
  const rule = getDb().prepare("SELECT * FROM ip_rules WHERE ip = ?")
    .get(normalized) as unknown as IpRule | undefined;
  if (!rule) return undefined;
  if (rule.expires_at && rule.expires_at < nowIso()) {
    getDb().prepare("DELETE FROM ip_rules WHERE id = ?").run(rule.id);
    return undefined;
  }
  return rule;
}

export function isIpBlocked(ip: string): boolean {
  return getIpRule(ip)?.action === "block";
}

export function saveIpRule(input: {
  ip: string; action: "watch" | "block"; reason?: string; createdBy: number;
  expiresAt?: string | null;
}): IpRule {
  const ip = normalizeIp(input.ip);
  if (!ip) throw new Error("IP 不合法");
  const db = getDb();
  db.prepare(
    `INSERT INTO ip_rules(ip, action, reason, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET action = excluded.action, reason = excluded.reason,
       created_by = excluded.created_by, created_at = excluded.created_at,
       expires_at = excluded.expires_at`
  ).run(ip, input.action, input.reason || null, input.createdBy, nowIso(),
    input.expiresAt || null);
  return getIpRule(ip)!;
}

export function deleteIpRule(id: number): boolean {
  const result = getDb().prepare("DELETE FROM ip_rules WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}
