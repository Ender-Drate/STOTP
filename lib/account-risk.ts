import type { User } from "./db";
import { findUserById, getDb, nowIso } from "./db";
import { countPasskeys } from "./passkeys";
import { ipRiskScores, riskLevel } from "./risk";

export type AccountRiskLevel = "low" | "medium" | "high" | "critical";

export interface AccountRisk {
  score: number;
  level: AccountRiskLevel;
  reasons: string[];
}

/** 账号风险分按天衰减：重置密码等事件设置的高风险不会永久保留。 */
export function storedAccountRisk(user: User): number {
  const raw = Math.max(0, Math.min(100, Number(user.risk_score) || 0));
  if (!raw) return 0;
  const updated = user.risk_updated_at ? Date.parse(user.risk_updated_at) : NaN;
  if (!Number.isFinite(updated)) return raw;
  const days = Math.max(0, (Date.now() - updated) / 86400_000);
  return Math.max(0, raw - Math.floor(days * 10));
}

/**
 * 账号 + 当前请求 IP 的粗粒度风险等级，用于找回密码等敏感流程。
 * 依赖已有 24h/72h 风控观测和账号自身的安全配置。
 */
export function accountRisk(
  user: User,
  ip: string,
  options: { ipScore?: number; passkeyCount?: number } = {},
): AccountRisk {
  const ipRisk = options.ipScore !== undefined
    ? { score: options.ipScore }
    : ipRiskScores().get(ip);
  const stored = storedAccountRisk(user);
  let score = Math.max(ipRisk?.score ?? 0, stored);
  const reasons: string[] = [];
  if (ipRisk && ipRisk.score >= 60) reasons.push(`IP 风险分 ${ipRisk.score}`);
  if (stored >= 30) reasons.push(`账号风险事件 ${stored}`);
  if (user.role === "superadmin") {
    score += 60;
    reasons.push("最高管理员账号");
  } else if (user.role === "admin") {
    score += 35;
    reasons.push("管理员账号");
  }
  if (user.email_verified !== 1) {
    score += 15;
    reasons.push("邮箱未验证");
  }
  const passkeys = options.passkeyCount ?? countPasskeys(user.id);
  if (!user.totp_secret && passkeys === 0) {
    score += 10;
    reasons.push("未配置 TOTP / Passkey");
  }
  if (user.status === "pending") {
    score += 20;
    reasons.push("账号待验证");
  }
  score = Math.min(100, score);
  return { score, level: riskLevel(score), reasons };
}

/** 将账号风险分提升到至少 minimum；用于密码重置等风险事件。 */
export function bumpAccountRisk(userId: number, minimum = 85): number {
  const user = findUserById(userId);
  if (!user) return 0;
  const next = Math.max(storedAccountRisk(user), Math.min(100, minimum));
  getDb().prepare(
    "UPDATE users SET risk_score = ?, risk_updated_at = ? WHERE id = ?"
  ).run(next, nowIso(), userId);
  return next;
}

/** 管理员手动清除风险事件分；角色/邮箱/2FA 等基础因素仍会参与计算。 */
export function clearAccountRisk(userId: number): void {
  getDb().prepare(
    "UPDATE users SET risk_score = 0, risk_updated_at = NULL WHERE id = ?"
  ).run(userId);
}
