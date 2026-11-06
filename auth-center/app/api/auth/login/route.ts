import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL, SESSION_TTL_SECONDS, STOTP_ENABLED } from "@/lib/config";
import { verifyPassword } from "@/lib/crypto";
import { audit, findUserByUsername, getDb, nowIso } from "@/lib/db";
import {
  assertSameOrigin,
  clientIp,
  errorResponse,
  HttpError,
  isFormRequest,
  rateLimit,
  readForm,
  readJson,
  safeNextPath,
} from "@/lib/http";
import { createSession, sessionCookieOptions } from "@/lib/session";
import { publicUser } from "@/lib/users";
import { getBinding } from "@/lib/stotp-store";
import { createChallenge } from "@/lib/login-challenge";

export const runtime = "nodejs";

interface Body {
  username?: string;
  password?: string;
  remember?: boolean | string;
  next?: string;
}

function loginRedirect(next: string, error?: string): NextResponse {
  const url = new URL("/login", PUBLIC_URL);
  url.searchParams.set("next", next);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

function otpRedirect(next: string, ticket: string): NextResponse {
  const url = new URL("/login/otp", PUBLIC_URL);
  url.searchParams.set("ticket", ticket);
  url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const formMode = isFormRequest(req);
  let next = "/dashboard";
  try {
    assertSameOrigin(req);
    const body: Body = formMode ? await readForm(req) : await readJson<Body>(req);
    next = safeNextPath(body.next);
    const identifier = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!identifier || !password) {
      throw new HttpError(400, "invalid_request", "请输入用户名与密码");
    }
    if (!rateLimit(`login:${clientIp(req)}:${identifier}`, 10, 300)) {
      throw new HttpError(429, "rate_limited", "尝试过于频繁，请 5 分钟后再试");
    }
    const user = findUserByUsername(identifier);
    if (!user || !verifyPassword(password, user.password_hash)) {
      audit("login_failed", { ip: clientIp(req), detail: identifier.slice(0, 40) });
      throw new HttpError(401, "invalid_credentials", "用户名或密码不正确");
    }
    if (user.status !== "active") {
      throw new HttpError(403, "account_disabled", "账号已被禁用");
    }
    const remember = body.remember === true || body.remember === "1" || body.remember === "on";
    const ttl = remember ? 30 * 24 * 3600 : SESSION_TTL_SECONDS;
    const binding = getBinding(user.id);
    if (binding && !STOTP_ENABLED) {
      throw new HttpError(503, "stotp_unavailable", "STOTP 配置缺失，暂时无法登录");
    }
    if (binding) {
      const { ticket, expiresIn } = createChallenge(user.id, ttl, clientIp(req));
      audit("stotp_login_challenge", {
        userId: user.id, clientId: binding.client_id, ip: clientIp(req),
      });
      if (formMode) return otpRedirect(next, ticket);
      return NextResponse.json({
        ok: false,
        otp_required: true,
        ticket,
        expires_in: expiresIn,
        next,
      });
    }
    const token = createSession(user.id, ttl);
    getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
    audit("login", { userId: user.id, ip: clientIp(req) });
    const options = sessionCookieOptions(ttl);
    if (formMode) {
      const res = NextResponse.redirect(new URL(next, PUBLIC_URL), 303);
      res.cookies.set(options.name, token, options);
      return res;
    }
    const res = NextResponse.json({ ok: true, user: publicUser(user) });
    res.cookies.set(options.name, token, options);
    return res;
  } catch (error) {
    if (formMode) {
      const message = error instanceof HttpError ? error.message : "登录失败，请重试";
      return loginRedirect(next, message);
    }
    return errorResponse(error);
  }
}
