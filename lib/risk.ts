import { getDb, nowIso, nowSec } from "./db";
import { sha256 } from "./crypto";
import { isPrivateIp as isPrivateIpImpl, normalizeIp } from "./ip";
import { lookupIpLocation } from "./geolocation";

export interface RiskSettings {
  captchaAfterFailures: number;
  loginFailWindowSeconds: number;
  riskHighThreshold: number;
  riskCriticalThreshold: number;
  auditRetentionDays: number;
  visitWindowHours: number;
}

export const RISK_DEFAULTS: RiskSettings = {
  captchaAfterFailures: 1,
  loginFailWindowSeconds: 900,
  riskHighThreshold: 70,
  riskCriticalThreshold: 90,
  auditRetentionDays: 30,
  visitWindowHours: 72,
};

const KEYS: Record<keyof RiskSettings, string> = {
  captchaAfterFailures: "captcha_after_failures",
  loginFailWindowSeconds: "login_fail_window_seconds",
  riskHighThreshold: "risk_high_threshold",
  riskCriticalThreshold: "risk_critical_threshold",
  auditRetentionDays: "audit_retention_days",
  visitWindowHours: "visit_window_hours",
};

export const RISK_LABELS: Record<keyof RiskSettings, string> = {
  captchaAfterFailures: "失败多少次后要求图形验证码",
  loginFailWindowSeconds: "失败计数窗口（秒）",
  riskHighThreshold: "高风险阈值",
  riskCriticalThreshold: "严重风险阈值",
  auditRetentionDays: "审计保留天数",
  visitWindowHours: "访问 IP 统计窗口（小时）",
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
    visitWindowHours: Math.max(1, Math.min(720, read("visitWindowHours"))),
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
    visitWindowHours: Math.max(1, Math.min(720, Number(input.visitWindowHours) || current.visitWindowHours)),
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
  return isPrivateIpImpl(ip);
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
  const observations = getDb().prepare(
    `SELECT ip, MAX(score) AS score FROM risk_observations
     WHERE ts >= ? GROUP BY ip`
  ).all(new Date(Date.now() - settings.visitWindowHours * 3600 * 1000).toISOString()) as unknown as Array<{
    ip: string; score: number;
  }>;
  const observed = new Map(observations.map((row) => [row.ip, Number(row.score) || 0]));
  const map = new Map<string, IpRisk>();
  for (const row of rows) {
    const privateIp = isPrivateIp(row.ip);
    const score = Math.max(
      privateIp ? Math.min(25, row.failures * 3) : Math.min(100, 15 + row.failures * 8),
      observed.get(row.ip) || 0
    );
    map.set(row.ip, {
      ip: row.ip, score, level: riskLevel(score, settings),
      failures: row.failures, private: privateIp,
    });
  }
  for (const row of observations) {
    if (map.has(row.ip)) continue;
    const score = Number(row.score) || 0;
    map.set(row.ip, {
      ip: row.ip, score, level: riskLevel(score, settings),
      failures: 0, private: isPrivateIp(row.ip),
    });
  }
  return map;
}

export interface VisitIp {
  ip: string;
  count: number;
  first: string;
  last: string;
  score: number;
  level: IpRisk["level"];
  location: string;
  userAgent: string | null;
  tlsFingerprint: string | null;
  reasons: string[];
}

interface ObservationRow {
  ip: string;
  ts: string;
  user_agent: string | null;
  tls_fingerprint: string | null;
  score: number;
  reasons: string | null;
}

export function getVisitIps(hours: number): VisitIp[] {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const db = getDb();
  const observations = db.prepare(
    `SELECT ip, ts, user_agent, tls_fingerprint, score, reasons
     FROM risk_observations WHERE ts >= ? ORDER BY id DESC LIMIT 2000`
  ).all(since) as unknown as ObservationRow[];
  const aggregated = new Map<string, VisitIp>();
  const latest = new Map<string, ObservationRow>();

  for (const row of observations) {
    const ip = normalizeIp(row.ip) || row.ip;
    if (!latest.has(ip)) latest.set(ip, row);
    const current = aggregated.get(ip);
    if (!current) {
      aggregated.set(ip, {
        ip, count: 1, first: row.ts, last: row.ts,
        score: row.score, level: "low",
        location: lookupIpLocation(ip),
        userAgent: row.user_agent, tlsFingerprint: row.tls_fingerprint,
        reasons: parseReasons(row.reasons),
      });
    } else {
      current.count += 1;
      if (row.ts < current.first) current.first = row.ts;
      current.score = Math.max(current.score, row.score);
    }
  }

  // 没有客户端观测的 API/登录请求也纳入 72h IP 列表
  const audits = db.prepare(
    `SELECT ip, COUNT(*) AS count, MIN(ts) AS first, MAX(ts) AS last
     FROM audit WHERE ts >= ? AND ip IS NOT NULL GROUP BY ip`
  ).all(since) as unknown as Array<{ ip: string; count: number; first: string; last: string }>;
  for (const row of audits) {
    const ip = normalizeIp(row.ip) || row.ip;
    if (aggregated.has(ip)) continue;
    aggregated.set(ip, {
      ip, count: row.count, first: row.first, last: row.last,
      score: 0, level: "low", location: lookupIpLocation(ip),
      userAgent: null, tlsFingerprint: null, reasons: [],
    });
  }

  const risks = new Map(
    Array.from(ipRiskScores().entries()).map(([ip, risk]) => [normalizeIp(ip) || ip, risk])
  );
  const list = Array.from(aggregated.values()).map((item) => {
    const risk = risks.get(item.ip);
    const score = Math.max(item.score, risk?.score || 0);
    return {
      ...item,
      score,
      level: riskLevel(score),
    };
  }).sort((a, b) => (a.last < b.last ? 1 : -1));
  return list.slice(0, 300);
}

function parseReasons(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

export interface RecentObservation {
  id: number;
  ts: string;
  ip: string;
  location: string;
  path: string | null;
  renderer: string;
  platform: string;
  tlsFingerprint: string | null;
  score: number;
  reasons: string[];
}

export function getRecentObservations(limit = 30): RecentObservation[] {
  const rows = getDb().prepare(
    `SELECT id, ts, ip, path, tls_fingerprint, signals, score, reasons
     FROM risk_observations ORDER BY id DESC LIMIT ?`
  ).all(limit) as unknown as Array<{
    id: number; ts: string; ip: string; path: string | null;
    tls_fingerprint: string | null; signals: string; score: number; reasons: string | null;
  }>;
  return rows.map((row) => {
    let signals: { webglRenderer?: string; platform?: string } = {};
    try { signals = JSON.parse(row.signals); } catch { /* ignore */ }
    return {
      id: row.id,
      ts: row.ts,
      ip: row.ip,
      location: lookupIpLocation(row.ip),
      path: row.path,
      renderer: signals.webglRenderer || "未提供",
      platform: signals.platform || "未知",
      tlsFingerprint: row.tls_fingerprint,
      score: row.score,
      reasons: parseReasons(row.reasons),
    };
  });
}
