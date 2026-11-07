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
  const db = getDb();
  // 旧版本 watch 规则没有到期时间，按创建时间补 72h，之后自动取消追踪。
  const legacyWatches = db.prepare(
    "SELECT id, created_at FROM ip_rules WHERE action = 'watch' AND expires_at IS NULL"
  ).all() as Array<{ id: number; created_at: string }>;
  for (const row of legacyWatches) {
    const created = Date.parse(row.created_at);
    const expiresAt = Number.isFinite(created)
      ? new Date(created + 72 * 3600 * 1000).toISOString()
      : new Date().toISOString();
    db.prepare("UPDATE ip_rules SET expires_at = ? WHERE id = ?")
      .run(expiresAt, row.id);
  }
  // 到期规则自动取消追踪，页面不再显示僵尸 watch 规则。
  db.prepare("DELETE FROM ip_rules WHERE expires_at IS NOT NULL AND expires_at < ?")
    .run(nowIso());
  return db.prepare(
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
  // 观察规则默认 72 小时后自动取消；封禁规则默认长期，除非显式 expiresAt。
  const expiresAt = input.expiresAt
    || (input.action === "watch"
      ? new Date(Date.now() + 72 * 3600 * 1000).toISOString()
      : null);
  db.prepare(
    `INSERT INTO ip_rules(ip, action, reason, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET action = excluded.action, reason = excluded.reason,
       created_by = excluded.created_by, created_at = excluded.created_at,
       expires_at = excluded.expires_at`
  ).run(ip, input.action, input.reason || null, input.createdBy, nowIso(), expiresAt);
  return getIpRule(ip)!;
}

export function deleteIpRule(id: number): boolean {
  const result = getDb().prepare("DELETE FROM ip_rules WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}
