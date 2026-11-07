import { verifyPassword } from "./crypto";
import { HttpError, rateLimit } from "./http";
import {
  clearLoginFailures, getLoginFailureCount, recordLoginFailure,
} from "./risk";
import { verifyTotp } from "./totp";

/**
 * 高价值账户操作再认证：当前密码 + 失败计数/限速。
 * 5 次失败后锁定到风险设置窗口结束，避免会话被盗后无限爆破当前密码。
 */
export function requireCurrentPassword(
  user: { id: number; password_hash: string },
  password: string,
  action: string,
): void {
  const failureKey = `reauth:${user.id}:${action}`;
  if (!rateLimit(`reauth-rate:${user.id}:${action}`, 10, 300)) {
    throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后再试");
  }
  if (getLoginFailureCount(failureKey) >= 5) {
    throw new HttpError(429, "reauth_locked", "验证失败次数过多，请稍后再试");
  }
  if (!password || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(failureKey);
    throw new HttpError(400, "invalid_credentials", "当前密码不正确");
  }
  clearLoginFailures(failureKey);
}

/** 已启用 TOTP 时，敏感操作必须再提供一次动态码。 */
export function requireSecondFactor(
  user: { id: number; totp_secret: string | null },
  code: string,
  action: string,
): void {
  if (!user.totp_secret) return;
  const failureKey = `reauth-otp:${user.id}:${action}`;
  if (!rateLimit(`reauth-otp-rate:${user.id}:${action}`, 10, 300)) {
    throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后再试");
  }
  if (getLoginFailureCount(failureKey) >= 5) {
    throw new HttpError(429, "reauth_locked", "验证码错误次数过多，请稍后再试");
  }
  if (!verifyTotp(user.totp_secret, code || "")) {
    recordLoginFailure(failureKey);
    throw new HttpError(400, "otp_invalid", "动态验证码不正确");
  }
  clearLoginFailures(failureKey);
}
