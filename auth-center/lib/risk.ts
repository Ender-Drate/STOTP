import { getDb, nowIso, nowSec } from "./db";
import { sha256 } from "./crypto";

export interface RiskSettings {
  captchaAfterFailures: number;
  loginFailWindowSeconds: number;
  riskHighThreshold: number;
  riskCriticalThreshold: number;
  auditRetentionDays: number;
}

export const RISK_DEFAULTS: RiskSettings = {
  captchaAfterFailures: 1,
  loginFailWindowSeconds: 900,
  riskHighThreshold: 70,
  riskCriticalThreshold: 90,
  auditRetentionDays: 30,
};

const KEYS: Record<keyof RiskSettings, string> = {
  captchaAfterFailures: "captcha_after_failures",
  loginFailWindowSeconds: "login_fail_window_seconds",
  riskHighThreshold: "risk_high_threshold",
  riskCriticalThreshold: "risk_critical_threshold",
  auditRetentionDays: "audit_retention_days",
};

export const RISK_LABELS: Record<keyof RiskSettings, string> = {
  captchaAfterFailures: "失败多少次后要求图形验证码",
  loginFailWindowSeconds: "失败计数窗口（秒）",
  riskHighThreshold: "高风险阈值",
  riskCriticalThreshold: "严重风险阈值",
  auditRetentionDays: "审计保留天数",
};

export function getRiskSettings(): RiskSettings {
  const rows = getDb().prepare("SELECT key, value FROM risk_settings").all() as unknown as Array<{
    key: string; value: string;
  }>;
  const map = new Map(rows.map((row) => [row.key, Number(row.value)]));
  const read = (key: keyof RiskSettings) => {
    const value = map.get(KEYS[key]);
    return Number.isFinite(value) ? Number(value) : RISK_DEFAULTS[key];
  };
  return {
    captchaAfterFailures: Math.max(1, read("captchaAfterFailures")),
    loginFailWindowSeconds: Math.max(60, read("loginFailWindowSeconds")),
    riskHighThreshold: Math.min(100, Math.max(1, read("riskHighThreshold"))),
    riskCriticalThreshold: Math.min(100, Math.max(1, read("riskCriticalThreshold"))),
    auditRetentionDays: Math.max(1, read("auditRetentionDays")),
  };
}

export function saveRiskSettings(input: Partial<RiskSettings>): RiskSettings {
  const current = getRiskSettings();
  const next: RiskSettings = {
    captchaAfterFailures: Math.max(1, Math.min(20, Number(input.captchaAfterFailures) || current.captchaAfterFailures)),
    loginFailWindowSeconds: Math.max(60, Math.min(86400, Number(input.loginFailWindowSeconds) || current.loginFailWindowSeconds)),
    riskHighThreshold: Math.max(1, Math.min(100, Number(input.riskHighThreshold) || current.riskHighThreshold)),
    riskCriticalThreshold: Math.max(1, Math.min(100, Number(input.riskCriticalThreshold) || current.riskCriticalThreshold)),
    auditRetentionDays: Math.max(1, Math.min(3650, Number(input.auditRetentionDays) || current.auditRetentionDays)),
  };
  if (next.riskCriticalThreshold <= next.riskHighThreshold) {
    next.riskCriticalThreshold = Math.min(100, next.riskHighThreshold + 10);
  }
  const db = getDb();
  const now = nowIso();
  const stmt = db.prepare(
    `INSERT INTO risk_settings(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  for (const key of Object.keys(KEYS) as Array<keyof RiskSettings>) {
    stmt.run(KEYS[key], String(next[key]), now);
  }
  return next;
}

export function loginFailureKey(ip: string, identifier: string): string {
  return sha256(`${ip}\n${identifier.trim().toLowerCase()}`);
}

export function getLoginFailureCount(key: string): number {
  const settings = getRiskSettings();
  const row = getDb().prepare("SELECT * FROM login_failures WHERE key = ?").get(key) as unknown as {
    count: number; first_at: number; last_at: number;
  } | undefined;
  if (!row) return 0;
  if (row.first_at < nowSec() - settings.loginFailWindowSeconds) {
    getDb().prepare("DELETE FROM login_failures WHERE key = ?").run(key);
    return 0;
  }
  return row.count;
}

export function recordLoginFailure(key: string): number {
  const settings = getRiskSettings();
  const now = nowSec();
  const row = getDb().prepare("SELECT * FROM login_failures WHERE key = ?").get(key) as unknown as {
    count: number; first_at: number;
  } | undefined;
  if (!row || row.first_at < now - settings.loginFailWindowSeconds) {
    getDb().prepare(
      `INSERT INTO login_failures(key, count, first_at, last_at) VALUES (?, 1, ?, ?)
       ON CONFLICT(key) DO UPDATE SET count = 1, first_at = excluded.first_at, last_at = excluded.last_at`
    ).run(key, now, now);
    return 1;
  }
  const count = row.count + 1;
  getDb().prepare("UPDATE login_failures SET count = ?, last_at = ? WHERE key = ?")
    .run(count, now, key);
  return count;
}

export function clearLoginFailures(key: string): void {
  getDb().prepare("DELETE FROM login_failures WHERE key = ?").run(key);
}

export function captchaRequiredFor(key: string): boolean {
  return getLoginFailureCount(key) >= getRiskSettings().captchaAfterFailures;
}

export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === "::1" || ip.startsWith("127.")) return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  return false;
}

export interface IpRisk {
  ip: string;
  score: number;
  level: "low" | "medium" | "high" | "critical";
  failures: number;
  private: boolean;
}

export function riskLevel(score: number, settings = getRiskSettings()): IpRisk["level"] {
  if (score >= settings.riskCriticalThreshold) return "critical";
  if (score >= settings.riskHighThreshold) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function ipRiskScores(): Map<string, IpRisk> {
  const settings = getRiskSettings();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = getDb().prepare(
    `SELECT ip, COUNT(*) AS failures FROM audit
     WHERE event IN ('login_failed', 'totp_login_deny', 'stotp_login_deny')
       AND ts >= ? AND ip IS NOT NULL GROUP BY ip`
  ).all(since) as unknown as Array<{ ip: string; failures: number }>;
  const map = new Map<string, IpRisk>();
  for (const row of rows) {
    const privateIp = isPrivateIp(row.ip);
    const score = privateIp
      ? Math.min(25, row.failures * 3)
      : Math.min(100, 15 + row.failures * 8);
    map.set(row.ip, {
      ip: row.ip, score, level: riskLevel(score, settings),
      failures: row.failures, private: privateIp,
    });
  }
  return map;
}
