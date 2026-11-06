import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL } from "@/lib/config";
import { audit, findUserById, getDb, nowIso } from "@/lib/db";
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
import { failChallenge, getChallenge, markChallengeUsed } from "@/lib/login-challenge";
import { createSession, sessionCookieOptions } from "@/lib/session";
import { getBinding, touchBinding } from "@/lib/stotp-store";
import { stotpConfigured, stotpLoginVerify, StotpError } from "@/lib/stotp";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

interface Body {
  ticket?: string;
  code?: string;
  next?: string;
}

function otpPage(next: string, ticket: string, error?: string): NextResponse {
  const url = new URL("/login/otp", PUBLIC_URL);
  url.searchParams.set("ticket", ticket);
  url.searchParams.set("next", next);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

function failure(next: string, ticket: string, formMode: boolean, error: HttpError) {
  if (formMode) return otpPage(next, ticket, error.message);
  return errorResponse(error);
}

export async function POST(req: NextRequest) {
  const formMode = isFormRequest(req);
  let next = "/dashboard";
  let ticket = "";
  try {
    assertSameOrigin(req);
    const body: Body = formMode ? await readForm(req) : await readJson<Body>(req);
    ticket = typeof body.ticket === "string" ? body.ticket : "";
    next = safeNextPath(body.next);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!ticket) throw new HttpError(401, "otp_expired", "验证会话已过期，请重新登录");
    if (!rateLimit(`otp:${clientIp(req)}`, 10, 300)) {
      throw new HttpError(429, "rate_limited", "尝试过于频繁，请稍后再试");
    }
    if (!stotpConfigured()) {
      throw new HttpError(503, "stotp_unavailable", "STOTP 未启用，请联系管理员");
    }
    const challenge = getChallenge(ticket, clientIp(req));
    if (!challenge) throw new HttpError(401, "otp_expired", "验证会话已过期，请重新登录");
    const user = findUserById(challenge.user_id);
    if (!user || user.status !== "active") {
      throw new HttpError(401, "invalid_credentials", "账号不可用");
    }
    const binding = getBinding(user.id);
    if (!binding) throw new HttpError(401, "otp_expired", "STOTP 绑定已失效，请重新登录");

    let result: Awaited<ReturnType<typeof stotpLoginVerify>>;
    try {
      result = await stotpLoginVerify(binding.client_id, code);
    } catch (error) {
      if (error instanceof StotpError) {
        audit("stotp_login_deny", {
          userId: user.id, clientId: binding.client_id, ip: clientIp(req),
          detail: error.code,
        });
        const status = error.code === "unavailable" || error.code === "disabled" ? 503 : 502;
        const httpError = new HttpError(status, error.code, "STOTP 验证服务暂不可用，请稍后重试");
        return failure(next, ticket, formMode, httpError);
      }
      throw error;
    }

    const accountMismatch = Boolean(
      binding.account_id && result.claims.sub !== binding.account_id
    );
    if (result.result !== "allow" || accountMismatch) {
      const attempts = failChallenge(ticket);
      audit("stotp_login_deny", {
        userId: user.id, clientId: binding.client_id, ip: clientIp(req),
        detail: attempts >= 5 ? "too_many_attempts" : result.reason || "deny",
      });
      const message = attempts >= 5
        ? "验证码错误次数过多，请重新登录"
        : "验证码不正确或设备不匹配";
      throw new HttpError(401, "otp_invalid", message);
    }

    markChallengeUsed(ticket);
    touchBinding(user.id);
    const token = createSession(user.id, challenge.ttl_seconds);
    getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
      .run(nowIso(), user.id);
    audit("stotp_login_allow", {
      userId: user.id, clientId: binding.client_id, ip: clientIp(req),
    });
    const options = sessionCookieOptions(challenge.ttl_seconds);
    if (formMode) {
      const res = NextResponse.redirect(new URL(next, PUBLIC_URL), 303);
      res.cookies.set(options.name, token, options);
      return res;
    }
    const res = NextResponse.json({ ok: true, user: publicUser(user) });
    res.cookies.set(options.name, token, options);
    return res;
  } catch (error) {
    if (formMode && error instanceof HttpError) {
      if (error.code === "otp_expired") {
        const url = new URL("/login", PUBLIC_URL);
        url.searchParams.set("next", next);
        url.searchParams.set("error", error.message);
        return NextResponse.redirect(url, 303);
      }
      return otpPage(next, ticket, error.message);
    }
    return errorResponse(error);
  }
}
