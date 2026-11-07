import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL, SESSION_TTL_SECONDS, STOTP_ENABLED } from "@/lib/config";
import { hashPassword, verifyPassword } from "@/lib/crypto";
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
import { isIpBlocked } from "@/lib/ip-rules";
import { decryptPasswordField } from "@/lib/password-crypto";
import { verifyCaptcha } from "@/lib/captcha";
import {
  accountFailureKey, captchaRequiredFor, clearLoginFailures, getRiskSettings,
  loginFailureKey, recordLoginFailure,
} from "@/lib/risk";

export const runtime = "nodejs";

// 用户不存在时也执行一次 scrypt，避免用响应耗时枚举账号。
const DUMMY_HASH = hashPassword("not-a-real-user-password");

interface Body {
  username?: string;
  password?: string;
  password_enc?: string;
  password_key?: string;
  remember?: boolean | string;
  next?: string;
  captchaTicket?: string;
  captchaCode?: string;
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
    const password = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    if (!identifier || !password) {
      throw new HttpError(400, "invalid_request", "请输入用户名与密码");
    }
    const ip = clientIp(req);
    const candidate = findUserByUsername(identifier);
    // 用户名和邮箱命中同一账号时共用一个账号维度计数
    const accountKey = accountFailureKey(candidate ? `user:${candidate.id}` : `id:${identifier.toLowerCase()}`);
    const ipFailureKey = loginFailureKey(ip, `id:${identifier.toLowerCase()}`);
    if (!rateLimit(`login:ip:${ip}:${identifier}`, 10, 300)
      || !rateLimit(`login:account:${accountKey}`, 30, 300)) {
      throw new HttpError(429, "rate_limited", "尝试过于频繁，请 5 分钟后再试");
    }
    if (isIpBlocked(ip)) {
      audit("ip_blocked", { ip, detail: identifier.slice(0, 40) });
      throw new HttpError(403, "ip_blocked", "当前 IP 已被限制，请联系管理员");
    }
    // 同一个账号无论用用户名还是邮箱登录，共用失败计数
    const failureKey = candidate ? loginFailureKey(ip, `user:${candidate.id}`) : ipFailureKey;
    if (captchaRequiredFor(accountKey) || captchaRequiredFor(failureKey)) {
      const captchaTicket = typeof body.captchaTicket === "string" ? body.captchaTicket : "";
      const captchaCode = typeof body.captchaCode === "string" ? body.captchaCode : "";
      if (!captchaTicket || !captchaCode) {
        throw new HttpError(400, "captcha_required", "请输入图形验证码", {
          captcha_required: true,
        });
      }
      if (!verifyCaptcha(captchaTicket, captchaCode, ip)) {
        throw new HttpError(400, "captcha_invalid", "图形验证码不正确", {
          captcha_required: true,
        });
      }
    }
    const user = candidate;
    // 常数时间对齐：账号不存在时也对固定 dummy hash 做一次 scrypt。
    const passwordOk = user
      ? verifyPassword(password, user.password_hash)
      : (verifyPassword(password, DUMMY_HASH), false);
    if (!user || !passwordOk) {
      const ipCount = recordLoginFailure(failureKey);
      const accountCount = recordLoginFailure(accountKey);
      audit("login_failed", { ip, detail: identifier.slice(0, 40) });
      const settings = getRiskSettings();
      throw new HttpError(401, "invalid_credentials", "用户名或密码不正确", {
        captcha_required: Math.max(ipCount, accountCount) >= settings.captchaAfterFailures,
      });
    }
    if (user.status !== "active") {
      audit("login_disabled", { ip, detail: identifier.slice(0, 40) });
      throw new HttpError(401, "invalid_credentials", "用户名或密码不正确");
    }
    clearLoginFailures(failureKey);
    clearLoginFailures(accountKey);
    const remember = body.remember === true || body.remember === "1" || body.remember === "on";
    const ttl = remember ? 30 * 24 * 3600 : SESSION_TTL_SECONDS;
    const binding = getBinding(user.id);
    if (user.totp_secret) {
      const { ticket, expiresIn } = createChallenge(user.id, ttl, clientIp(req), "totp");
      audit("totp_login_challenge", {
        userId: user.id, ip: clientIp(req),
      });
      if (formMode) return otpRedirect(next, ticket);
      return NextResponse.json({
        ok: false,
        otp_required: true,
        method: "totp",
        ticket,
        expires_in: expiresIn,
        next,
      });
    }
    if (binding && !STOTP_ENABLED) {
      throw new HttpError(503, "stotp_unavailable", "STOTP 配置缺失，暂时无法登录");
    }
    if (binding) {
      const { ticket, expiresIn } = createChallenge(user.id, ttl, clientIp(req), "stotp");
      audit("stotp_login_challenge", {
        userId: user.id, clientId: binding.client_id, ip: clientIp(req),
      });
      if (formMode) return otpRedirect(next, ticket);
      return NextResponse.json({
        ok: false,
        otp_required: true,
        method: "stotp",
        ticket,
        expires_in: expiresIn,
        next,
      });
    }
    const token = createSession(user.id, ttl, {
      ip, userAgent: req.headers.get("user-agent") || "",
    });
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
