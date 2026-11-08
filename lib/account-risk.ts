import type { User } from "./db";
import { countPasskeys } from "./passkeys";
import { ipRiskScores, riskLevel } from "./risk";

export type AccountRiskLevel = "low" | "medium" | "high" | "critical";

export interface AccountRisk {
  score: number;
  level: AccountRiskLevel;
  reasons: string[];
}

/**
 * 账号 + 当前请求 IP 的粗粒度风险等级，用于找回密码等敏感流程。
 * 依赖已有 24h/72h 风控观测和账号自身的安全配置。
 */
export function accountRisk(user: User, ip: string): AccountRisk {
  const ipRisk = ipRiskScores().get(ip);
  let score = ipRisk?.score ?? 0;
  const reasons: string[] = [];
  if (ipRisk && ipRisk.score >= 60) reasons.push(`IP 风险分 ${ipRisk.score}`);
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
  if (!user.totp_secret && countPasskeys(user.id) === 0) {
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
