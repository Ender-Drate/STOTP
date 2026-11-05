const raw = process.env.AUTH_PUBLIC_URL || "http://localhost:3100";

/** 对外基础地址，用于 issuer / 回调拼接。 */
export const PUBLIC_URL = raw.replace(/\/+$/, "");

export const BRAND = {
  name: "STOTP 账户",
  short: "STOTP",
};

export const SESSION_COOKIE = "ac_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export const ACCESS_TOKEN_TTL = 15 * 60;
export const REFRESH_TOKEN_TTL = 30 * 24 * 3600;
export const AUTH_CODE_TTL = 10 * 60;
export const CONSENT_TTL = 180 * 24 * 3600;
