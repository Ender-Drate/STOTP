const raw = process.env.AUTH_PUBLIC_URL || "http://localhost:3100";

/** 对外基础地址，用于 issuer / 回调拼接。 */
export const PUBLIC_URL = raw.replace(/\/+$/, "");
export const TRUST_PROXY = process.env.AUTH_TRUST_PROXY !== "0";

const localHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(PUBLIC_URL);
if (process.env.NODE_ENV === "production" && process.env.AUTH_E2E === "1" && !localHttp) {
  throw new Error("AUTH_E2E=1 只能用于本地测试，生产环境拒绝启动");
}

export const BRAND = {
  name: "STOTP 账户",
  short: "STOTP",
};

// __Host- 要求 Secure + Path=/ + 无 Domain，避免同域子应用覆盖。
export const SESSION_COOKIE = PUBLIC_URL.startsWith("https://")
  ? "__Host-ac_session"
  : "ac_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export const ACCESS_TOKEN_TTL = 15 * 60;
export const REFRESH_TOKEN_TTL = 30 * 24 * 3600;
export const AUTH_CODE_TTL = 10 * 60;
export const CONSENT_TTL = 180 * 24 * 3600;

const stotpBase = (process.env.STOTP_BASE_URL || "").replace(/\/+$/, "");
const stotpClientId = process.env.STOTP_LOGIN_CLIENT_ID || "";
const stotpClientSecret = process.env.STOTP_LOGIN_CLIENT_SECRET || "";

export const STOTP_BASE_URL = stotpBase;
export const STOTP_LOGIN_CLIENT_ID = stotpClientId;
export const STOTP_LOGIN_CLIENT_SECRET = stotpClientSecret;
export const STOTP_TIMEOUT_MS = Number(process.env.STOTP_TIMEOUT_MS || 5000);
export const STOTP_ENABLED = Boolean(
  stotpBase && stotpClientId && stotpClientSecret
);

