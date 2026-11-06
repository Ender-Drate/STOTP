import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import {
  STOTP_BASE_URL,
  STOTP_ENABLED,
  STOTP_ENFORCE,
  STOTP_LOGIN_CLIENT_ID,
  STOTP_LOGIN_CLIENT_SECRET,
  STOTP_TIMEOUT_MS,
} from "./config";

export class StotpError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const globalForStotp = globalThis as unknown as {
  __stotpToken?: { token: string; expiresAt: number };
};

/** 未配置时返回 false，调用方应保持原密码登录行为。 */
export function stotpConfigured(): boolean {
  return STOTP_ENABLED && STOTP_ENFORCE !== "off";
}

export function stotpEnforce(): "off" | "bound" | "all" {
  return STOTP_ENFORCE;
}

function assertionKey(): Buffer {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(STOTP_LOGIN_CLIENT_SECRET, "utf8"),
    Buffer.from(STOTP_LOGIN_CLIENT_ID, "utf8"),
    Buffer.from("stotp/assertion/v1", "utf8"),
    32
  ));
}

function b64urlJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

export interface StotpAssertion {
  iss: string;
  aud: string;
  sub: string;
  result: "allow" | "deny";
  reason?: string;
  client_id: string;
  epoch?: number;
  exp: number;
  jti: string;
  [key: string]: unknown;
}

/** 验证 STOTP 服务端返回的 HS256 assertion。 */
export function verifyAssertion(assertion: string, expectedClientId: string): StotpAssertion {
  const parts = assertion.split(".");
  if (parts.length !== 3) throw new StotpError("bad_assertion", "assertion 格式错误");
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string };
  try {
    header = b64urlJson(headerB64) as { alg?: string };
  } catch {
    throw new StotpError("bad_assertion", "assertion header 无法解析");
  }
  if (header.alg !== "HS256") throw new StotpError("bad_assertion", "assertion 算法不支持");

  const expected = createHmac("sha256", assertionKey())
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signatureB64, "base64url");
  } catch {
    throw new StotpError("bad_assertion", "assertion 签名无法解析");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new StotpError("bad_assertion", "assertion 签名不匹配");
  }

  let claims: StotpAssertion;
  try {
    claims = b64urlJson(payloadB64) as StotpAssertion;
  } catch {
    throw new StotpError("bad_assertion", "assertion payload 无法解析");
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== "stotp") throw new StotpError("bad_assertion", "assertion iss 不匹配");
  if (claims.aud !== STOTP_LOGIN_CLIENT_ID) {
    throw new StotpError("bad_assertion", "assertion aud 不匹配");
  }
  if (claims.client_id !== expectedClientId) {
    throw new StotpError("bad_assertion", "assertion client_id 不匹配");
  }
  if (typeof claims.exp !== "number" || claims.exp + 30 < now) {
    throw new StotpError("bad_assertion", "assertion 已过期");
  }
  if (claims.result !== "allow" && claims.result !== "deny") {
    throw new StotpError("bad_assertion", "assertion result 不合法");
  }
  return claims;
}

async function getClientToken(force = false): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = globalForStotp.__stotpToken;
  if (!force && cached && cached.expiresAt > now + 30) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: STOTP_LOGIN_CLIENT_ID,
    client_secret: STOTP_LOGIN_CLIENT_SECRET,
    scope: "stotp.verify",
  });
  let res: Response;
  try {
    res = await fetch(`${STOTP_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(STOTP_TIMEOUT_MS),
    });
  } catch {
    throw new StotpError("unavailable", "无法连接 STOTP 服务端");
  }
  if (!res.ok) {
    throw new StotpError("token_failed", `STOTP 令牌请求失败（${res.status}）`);
  }
  const data = await res.json().catch(() => null) as {
    access_token?: string; expires_in?: number;
  } | null;
  if (!data?.access_token) throw new StotpError("token_failed", "STOTP 未返回 access_token");
  const ttl = Number(data.expires_in || 900);
  globalForStotp.__stotpToken = {
    token: data.access_token,
    expiresAt: now + Math.max(60, ttl - 30),
  };
  return data.access_token;
}

export interface StotpVerifyResult {
  result: "allow" | "deny";
  reason?: string;
  claims: StotpAssertion;
}

/** 服务端代算 epoch/uuid 的登录站校验：只提交 client_id + code。 */
export async function stotpLoginVerify(
  clientId: string,
  code: string
): Promise<StotpVerifyResult> {
  if (!STOTP_ENABLED) throw new StotpError("disabled", "未配置 STOTP");
  let token = await getClientToken();
  let res: Response;
  try {
    res = await fetch(`${STOTP_BASE_URL}/v1/login/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ client_id: clientId, code }),
      signal: AbortSignal.timeout(STOTP_TIMEOUT_MS),
    });
  } catch {
    throw new StotpError("unavailable", "无法连接 STOTP 服务端");
  }
  if (res.status === 401) {
    // token 过期或密钥轮换：清缓存重试一次
    globalForStotp.__stotpToken = undefined;
    token = await getClientToken(true);
    try {
      res = await fetch(`${STOTP_BASE_URL}/v1/login/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ client_id: clientId, code }),
        signal: AbortSignal.timeout(STOTP_TIMEOUT_MS),
      });
    } catch {
      throw new StotpError("unavailable", "无法连接 STOTP 服务端");
    }
  }
  if (res.status === 404) throw new StotpError("disabled", "STOTP 登录站接口未启用");
  if (!res.ok) throw new StotpError("verify_failed", `STOTP 校验失败（${res.status}）`);
  const data = await res.json().catch(() => null) as {
    mode?: string; assertion?: string;
  } | null;
  if (data?.mode !== "assertion" || !data.assertion) {
    throw new StotpError("bad_assertion", "STOTP 响应不是 assertion 模式");
  }
  const claims = verifyAssertion(data.assertion, clientId);
  return { result: claims.result, reason: claims.reason, claims };
}
