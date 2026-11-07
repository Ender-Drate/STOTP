import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { PUBLIC_URL, SESSION_TTL_SECONDS } from "@/lib/config";
import { hashPassword } from "@/lib/crypto";
import { audit, findUserByUsername, getDb, nowIso } from "@/lib/db";
import { clientIp, safeNextPath } from "@/lib/http";
import {
  consumeOAuthState, findProviderLink, getProvider, linkProvider, OAUTH_STATE_COOKIE,
} from "@/lib/login-providers";
import { getRoleByKey } from "@/lib/roles";
import { createSession, sessionCookieOptions } from "@/lib/session";
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
  preferred_username?: string;
  picture?: string;
}

function uniqueUsername(base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24) || "user";
  let candidate = clean.length >= 3 ? clean : `${clean}_user`;
  let suffix = 0;
  while (findUserByUsername(candidate)) {
    suffix += 1;
    candidate = `${clean.slice(0, 20)}_${suffix}`;
  }
  return candidate;
}

export async function GET(req: NextRequest) {
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

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(provider.token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // 同时带 Basic 与 body secret：兼容 client_secret_basic / client_secret_post
        Authorization: `Basic ${Buffer.from(
          `${provider.client_id}:${provider.client_secret}`
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${PUBLIC_URL}/api/oauth/callback`,
        client_id: provider.client_id,
        client_secret: provider.client_secret,
        code_verifier: row.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fail("无法连接登录服务", row.next);
  }
  const tokenData = await tokenResponse.json().catch(() => null) as {
    access_token?: string; error_description?: string;
  } | null;
  if (!tokenResponse.ok || !tokenData?.access_token) {
    return fail(tokenData?.error_description || "登录服务令牌交换失败", row.next);
  }

  let profile: ProviderUser;
  try {
    const userinfoResponse = await fetch(provider.userinfo_url, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
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
  let user = link ? getDb().prepare("SELECT * FROM users WHERE id = ?")
    .get(link.user_id) as unknown as ReturnType<typeof findUserByUsername> : undefined;
  if (user && user.status !== "active") return fail("账号已被禁用", row.next);

  if (!user) {
    const verifiedEmail = profile.email_verified === true
      || profile.email_verified === "true"
      || profile.email_verified === 1;
    if (!verifiedEmail || !profile.email) {
      return fail("登录服务未返回已验证邮箱，无法自动创建账号", row.next);
    }
    const existing = findUserByUsername(profile.email);
    if (existing) {
      if (existing.status !== "active") return fail("账号已被禁用", row.next);
      user = existing;
    } else {
      const role = getRoleByKey("user");
      if (!role) return fail("账号初始化失败", row.next);
      const username = uniqueUsername(
        profile.preferred_username || profile.email.split("@")[0] || profile.name || "user"
      );
      const result = getDb().prepare(
        `INSERT INTO users(username, email, password_hash, display_name, role, role_id,
           status, permissions, created_at)
         VALUES (?, ?, ?, ?, 'user', ?, 'active', ?, ?)`
      ).run(username, profile.email, hashPassword(randomBytes(24).toString("base64url")),
        profile.name || username, role.id, role.permissions, nowIso());
      user = getDb().prepare("SELECT * FROM users WHERE id = ?")
        .get(Number(result.lastInsertRowid)) as unknown as ReturnType<typeof findUserByUsername>;
      audit("provider_register", { userId: Number(result.lastInsertRowid), detail: provider.key });
    }
    if (!user) return fail("账号创建失败", row.next);
    linkProvider(provider.id, subject, user.id);
  }

  if (!user) return fail("账号不存在", row.next);
  const ttl = SESSION_TTL_SECONDS;
  const token = createSession(user.id, ttl);
  getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
    .run(nowIso(), user.id);
  audit("provider_login", {
    userId: user.id, clientId: provider.key, ip: clientIp(req),
  });
  const options = sessionCookieOptions(ttl);
  const res = NextResponse.redirect(new URL(row.next, PUBLIC_URL), 303);
  res.cookies.set(options.name, token, options);
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
