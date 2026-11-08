import { getDb, nowIso } from "./db";
import { normalizeIp } from "./ip";

export function ipRiskClears(): Map<string, string> {
  const rows = getDb().prepare("SELECT ip, cleared_at FROM ip_risk_clears")
    .all() as Array<{ ip: string; cleared_at: string }>;
  return new Map(rows.map((row) => [row.ip, row.cleared_at]));
}

export function clearIpRisk(rawIp: string, clearedBy: number): string {
  const ip = normalizeIp(rawIp);
  if (!ip) throw new Error("IP 不合法");
  const now = nowIso();
  getDb().prepare(
    `INSERT INTO ip_risk_clears(ip, cleared_at, cleared_by, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET cleared_at = excluded.cleared_at,
       cleared_by = excluded.cleared_by, created_at = excluded.created_at`
  ).run(ip, now, clearedBy, now);
  return ip;
}
