import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL, SESSION_TTL_SECONDS, STOTP_ENABLED } from "@/lib/config";
import { audit, findUserById, getDb, nowIso } from "@/lib/db";
import { clientIp } from "@/lib/http";
import { isIpBlocked } from "@/lib/ip-rules";
import { createChallenge } from "@/lib/login-challenge";
import {
  consumeOAuthState, createLinkTicket, findProviderLink, getProvider, OAUTH_STATE_COOKIE,
} from "@/lib/login-providers";
import { createSession, sessionCookieOptions } from "@/lib/session";
import { getBinding } from "@/lib/stotp-store";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

function fail(message: string, next = "/dashboard"): NextResponse {
  const url = new URL("/login", PUBLIC_URL);
  url.searchParams.set("next", next);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url, 303);
}

interface ProviderUser {
  sub?: string;
  id?: string | number;
  email?: string;
  email_verified?: boolean | string | number;
  name?: string;
  login?: string;
  preferred_username?: string;
  picture?: string;
}

interface TokenData {
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function readTokenResponse(res: Response): Promise<TokenData> {
  const text = await res.text();
  try {
    return JSON.parse(text) as TokenData;
  } catch {
    // GitHub 等默认返回 application/x-www-form-urlencoded
    return Object.fromEntries(new URLSearchParams(text)) as TokenData;
  }
}

async function exchangeCode(
  provider: NonNullable<ReturnType<typeof getProvider>>,
  code: string,
  verifier: string,
  useBasicAuth: boolean,
): Promise<{ ok: boolean; status: number; data: TokenData }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${PUBLIC_URL}/api/oauth/callback`,
    client_id: provider.client_id,
    code_verifier: verifier,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": "STOTP-Auth-Center",
  };
  if (useBasicAuth) {
    headers.Authorization = `Basic ${Buffer.from(
      `${provider.client_id}:${provider.client_secret}`
    ).toString("base64")}`;
  } else {
    body.set("client_secret", provider.client_secret);
  }
  const res = await fetch(provider.token_url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status, data: await readTokenResponse(res) };
}

export async function GET(req: NextRequest) {
  if (isIpBlocked(clientIp(req))) return fail("当前 IP 已被限制，请联系管理员");
  const params = req.nextUrl.searchParams;
  const state = params.get("state") || "";
  const code = params.get("code") || "";
  const error = params.get("error");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value || "";
  if (error) return fail(params.get("error_description") || error);
  if (!state || state !== cookieState) return fail("登录状态校验失败，请重试");
  const row = consumeOAuthState(state, clientIp(req));
  if (!row) return fail("登录会话已过期，请重试");
  const provider = getProvider(row.provider_id);
  if (!provider || !provider.enabled) return fail("登录服务已停用");
  if (!code) return fail("登录服务未返回 code");

  let tokenResult: { ok: boolean; status: number; data: TokenData };
  try {
    tokenResult = await exchangeCode(provider, code, row.verifier, false);
    const clientError = tokenResult.data.error === "invalid_client"
      || tokenResult.data.error === "incorrect_client_credentials";
    if ((!tokenResult.ok || clientError) && (tokenResult.status === 401 || clientError)) {
      tokenResult = await exchangeCode(provider, code, row.verifier, true);
    }
  } catch {
    return fail("无法连接登录服务", row.next);
  }
  if (!tokenResult.ok || !tokenResult.data.access_token) {
    return fail(
      tokenResult.data.error_description || tokenResult.data.error || "登录服务令牌交换失败",
      row.next
    );
  }
  const accessToken = tokenResult.data.access_token;

  let profile: ProviderUser;
  try {
    const userinfoResponse = await fetch(provider.userinfo_url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "STOTP-Auth-Center",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!userinfoResponse.ok) return fail("登录服务未返回用户信息", row.next);
    profile = await userinfoResponse.json() as ProviderUser;
  } catch {
    return fail("读取登录服务用户信息失败", row.next);
  }
  const subject = String(profile.sub ?? profile.id ?? "");
  if (!subject) return fail("登录服务未返回用户标识", row.next);

  const link = findProviderLink(provider.id, subject);
  if (!link) {
    // 第三方账户必须先与本地账户绑定一次，不能自动创建/按邮箱接管账号
    const ticket = createLinkTicket({
      providerId: provider.id,
      subject,
      displayName: profile.name || profile.preferred_username || profile.login || "",
      email: profile.email || "",
      next: row.next,
      ip: clientIp(req),
    });
    const url = new URL("/login/link", PUBLIC_URL);
    url.searchParams.set("ticket", ticket);
    url.searchParams.set("next", row.next);
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  const user = findUserById(link.user_id);
  if (!user || user.status !== "active") return fail("账号不存在或已被禁用", row.next);

  // 第三方登录不能绕过本地第二因素
  const otp = (() => {
    if (user.totp_secret) {
      return { method: "totp" as const, challenge: createChallenge(
        user.id, SESSION_TTL_SECONDS, clientIp(req), "totp"
      ) };
    }
    const binding = getBinding(user.id);
    if (binding) {
      if (!STOTP_ENABLED) return { method: "unavailable" as const };
      return { method: "stotp" as const, challenge: createChallenge(
        user.id, SESSION_TTL_SECONDS, clientIp(req), "stotp"
      ) };
    }
    return null;
  })();

  if (otp?.method === "unavailable") {
    return fail("账号启用了第二因素，但验证服务不可用", row.next);
  }
  if (otp) {
    audit(otp.method === "totp" ? "totp_login_challenge" : "stotp_login_challenge", {
      userId: user.id, clientId: provider.key, ip: clientIp(req),
      detail: "provider",
    });
    const url = new URL("/login/otp", PUBLIC_URL);
    url.searchParams.set("ticket", otp.challenge.ticket);
    url.searchParams.set("next", row.next);
    return NextResponse.redirect(url, 303);
  }

  const token = createSession(user.id, SESSION_TTL_SECONDS, {
    ip: clientIp(req), userAgent: req.headers.get("user-agent") || "",
  });
  getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
    .run(nowIso(), user.id);
  audit("provider_login", {
    userId: user.id, clientId: provider.key, ip: clientIp(req),
  });
  const options = sessionCookieOptions(SESSION_TTL_SECONDS);
  const res = NextResponse.redirect(new URL(row.next, PUBLIC_URL), 303);
  res.cookies.set(options.name, token, options);
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
