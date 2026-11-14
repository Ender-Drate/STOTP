import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PUBLIC_URL, SESSION_TTL_SECONDS } from "@/lib/config";
import { hashPassword } from "@/lib/crypto";
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
import { isIpBlocked } from "@/lib/ip-rules";
import { decryptPasswordField } from "@/lib/password-crypto";
import { publicUser } from "@/lib/users";
import { getRoleByKey } from "@/lib/roles";
import { email, username } from "@/lib/validators";
import { verifyCaptcha, CAPTCHA_COOKIE } from "@/lib/captcha";
import { issueEmailVerification } from "@/lib/email-verification";
import { mailConfigured, sendVerificationEmail } from "@/lib/mailer";

export const runtime = "nodejs";

interface Body {
  username?: string;
  email?: string;
  password?: string;
  password_enc?: string;
  password_key?: string;
  displayName?: string;
  next?: string;
  captchaCode?: string;
}

const E2E = process.env.AUTH_E2E === "1";
const REQUIRE_EMAIL_VERIFICATION = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== "0" && !E2E;

function registerRedirect(next: string, error?: string): NextResponse {
  const url = new URL("/register", PUBLIC_URL);
  url.searchParams.set("next", next);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

function pendingRedirect(next: string, mail: string, failed = false): NextResponse {
  const url = new URL("/register/pending", PUBLIC_URL);
  url.searchParams.set("email", mail);
  url.searchParams.set("next", next);
  if (failed) url.searchParams.set("mail", "failed");
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const formMode = isFormRequest(req);
  let next = "/dashboard";
  try {
    assertSameOrigin(req);
    const body: Body = formMode ? await readForm(req) : await readJson<Body>(req);
    next = safeNextPath(body.next);
    const ip = clientIp(req);
    if (!rateLimit(`register:${ip}`, 10, 3600)) {
      throw new HttpError(429, "rate_limited", "注册过于频繁，请稍后再试");
    }
    if (isIpBlocked(ip)) {
      throw new HttpError(403, "ip_blocked", "当前 IP 已被限制");
    }
    if (!E2E) {
      const captchaToken = req.cookies.get(CAPTCHA_COOKIE)?.value || "";
      const captchaCode = typeof body.captchaCode === "string" ? body.captchaCode : "";
      if (!captchaToken || !captchaCode) {
        throw new HttpError(400, "captcha_required", "请输入图形验证码", {
          captcha_required: true,
        });
      }
      if (!verifyCaptcha(captchaToken, captchaCode, ip, "register")) {
        throw new HttpError(400, "captcha_invalid", "图形验证码不正确", {
          captcha_required: true,
        });
      }
    }
    const name = username(body.username);
    const mail = email(body.email);
    const pass = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    if (pass.length < 10) throw new HttpError(400, "invalid_request", "密码至少 10 位");
    if (pass.length > 128) throw new HttpError(400, "invalid_request", "密码过长");
    if (REQUIRE_EMAIL_VERIFICATION && !mailConfigured()) {
      throw new HttpError(503, "mail_unavailable", "邮件服务未配置，暂时无法开放注册");
    }
    const passwordHash = await hashPassword(pass);
    if (findUserByUsername(name) || findUserByUsername(mail)) {
      // 不明确区分用户名/邮箱占用，降低账号枚举质量
      throw new HttpError(400, "invalid_request", "注册信息不可用，请更换用户名或邮箱");
    }
    const now = nowIso();
    const userRole = getRoleByKey("user");
    if (!userRole) throw new HttpError(500, "server_error", "权限等级初始化失败");
    const status = REQUIRE_EMAIL_VERIFICATION ? "pending" : "active";
    const result = getDb().prepare(
      `INSERT INTO users(uuid, username, email, password_hash, display_name, role, role_id,
         status, permissions, email_verified, created_at)
       VALUES (?,?,?,?,?, 'user', ?, ?, ?, 0, ?)`
    ).run(randomUUID(), name, mail, passwordHash,
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim().slice(0, 40) : name,
      userRole.id, status, userRole.permissions, now);
    const userId = Number(result.lastInsertRowid);

    if (REQUIRE_EMAIL_VERIFICATION) {
      const token = issueEmailVerification(userId);
      let mailSent = true;
      try {
        await sendVerificationEmail(mail, token);
      } catch (error) {
        mailSent = false;
        console.error("[auth-center] verification email failed", error);
        audit("user_register", { userId, ip, detail: "mail_failed" });
      }
      if (mailSent) {
        audit("user_register", { userId, ip, detail: "pending_email" });
      }
      if (formMode) return pendingRedirect(next, mail, !mailSent);
      return NextResponse.json(
        {
          ok: true,
          pending: true,
          email: mail,
          mailSent,
          message: mailSent
            ? "验证邮件已发送，请打开邮件完成验证后登录"
            : "账号已创建，但验证邮件发送失败，请在等待页重发",
        },
        { status: 202, headers: { "Cache-Control": "no-store" } }
      );
    }

    const token = createSession(userId, SESSION_TTL_SECONDS, {
      ip, userAgent: req.headers.get("user-agent") || "",
    });
    audit("user_register", { userId, ip, detail: "e2e_or_disabled_verification" });
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId);
    const options = sessionCookieOptions(SESSION_TTL_SECONDS);
    if (formMode) {
      const res = NextResponse.redirect(new URL(next, PUBLIC_URL), 303);
      res.cookies.set(options.name, token, options);
      return res;
    }
    const res = NextResponse.json({ ok: true, user: publicUser(user as never) });
    res.cookies.set(options.name, token, options);
    return res;
  } catch (error) {
    if (formMode) {
      const message = error instanceof HttpError ? error.message : "注册失败，请重试";
      return registerRedirect(next, message);
    }
    return errorResponse(error);
  }
}
