import { audit, getDb, nowSec } from "./db";
import { getSetting, setSetting } from "./settings-store";
import { getRiskSettings, riskLevel } from "./risk";

export const ACTIVE_DEFENSE_SETTING = "active_defense";
export const MAX_DEFENSE_SECONDS = 15 * 60;

export type DefenseAction = "throttle" | "block";
export type DefenseLevel = "low" | "medium" | "high" | "critical";

export interface IpDefense {
  ip: string;
  action: DefenseAction;
  reason: string;
  level: DefenseLevel;
  score: number;
  until: number;
  created_at: number;
  source: string;
}

export function activeDefenseEnabled(): boolean {
  return getSetting(ACTIVE_DEFENSE_SETTING) === "1";
}

export function setActiveDefenseEnabled(enabled: boolean): void {
  setSetting(ACTIVE_DEFENSE_SETTING, enabled ? "1" : "0");
  if (!enabled) {
    getDb().prepare("DELETE FROM ip_defenses").run();
  }
}

export function listDefenses(): IpDefense[] {
  const now = nowSec();
  getDb().prepare("DELETE FROM ip_defenses WHERE until < ?").run(now);
  return getDb().prepare(
    "SELECT * FROM ip_defenses WHERE until > ? ORDER BY until DESC, ip ASC"
  ).all(now) as unknown as IpDefense[];
}

export function getDefense(ip: string): IpDefense | null {
  if (!ip) return null;
  const row = getDb().prepare("SELECT * FROM ip_defenses WHERE ip = ?")
    .get(ip) as unknown as IpDefense | undefined;
  if (!row) return null;
  if (row.until <= nowSec()) {
    getDb().prepare("DELETE FROM ip_defenses WHERE ip = ?").run(ip);
    return null;
  }
  return row;
}

export function clearDefense(ip: string): boolean {
  const result = getDb().prepare("DELETE FROM ip_defenses WHERE ip = ?").run(ip);
  return Number(result.changes) > 0;
}

function defenseReason(reasons: string[], level: DefenseLevel): string {
  const text = reasons.filter(Boolean).slice(0, 2).join("；");
  return (text || `风险等级 ${level}`).slice(0, 160);
}

/**
 * Turn a risk evaluation into a temporary IP defense when active defense is
 * enabled. Durations are derived from the risk type and level and are hard
 * capped at 15 minutes.
 */
export function applyAutoDefense(
  ip: string,
  score: number,
  reasons: string[],
): IpDefense | null {
  if (!activeDefenseEnabled() || !ip) return null;
  const settings = getRiskSettings();
  const level = riskLevel(score, settings) as DefenseLevel;
  if (level === "low" && !reasons.some((reason) =>
    /自动化|headless|webdriver|CDP|语言|平台|触摸|PDF|Client Hints|Sec-Fetch/i.test(reason))) {
    return null;
  }

  const automation = reasons.some((reason) =>
    /自动化|headless|webdriver|puppeteer|playwright|selenium|CDP|User-Agent\/WebGL|语言|平台|触摸|PDF|Client Hints|Sec-Fetch/i.test(reason));
  const tlsAnomaly = reasons.some((reason) => /TLS/i.test(reason));
  const base = automation ? 600 : tlsAnomaly ? 300 : 180;
  const multiplier = level === "critical" ? 1.5 : level === "high" ? 1 : level === "medium" ? 0.5 : 0.25;
  const duration = Math.min(MAX_DEFENSE_SECONDS, Math.max(60, Math.round(base * multiplier)));
  const action: DefenseAction = level === "critical" || level === "high" ? "block" : "throttle";
  const until = nowSec() + duration;
  const reason = defenseReason(reasons, level);

  const existing = getDefense(ip);
  const keepBlock = existing?.action === "block" && existing.until > until;
  getDb().prepare(
    `INSERT INTO ip_defenses(ip, action, reason, level, score, until, created_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'auto')
     ON CONFLICT(ip) DO UPDATE SET
       action = CASE WHEN ip_defenses.action = 'block' AND excluded.action = 'throttle'
         THEN 'block' ELSE excluded.action END,
       reason = excluded.reason,
       level = excluded.level,
       score = MAX(ip_defenses.score, excluded.score),
       until = MAX(ip_defenses.until, excluded.until),
       created_at = excluded.created_at`
  ).run(ip, keepBlock ? "block" : action, reason, level, score, until, nowSec());
  const defense = getDefense(ip);
  if (defense) {
    audit("ip_defense", {
      ip,
      detail: `${defense.action}:${defense.level}:${Math.max(1, defense.until - nowSec())}s:${reason}`,
    });
  }
  return defense;
}

export function defenseRemaining(defense: IpDefense): number {
  return Math.max(0, defense.until - nowSec());
}
