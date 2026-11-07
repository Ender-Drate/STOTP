import { NextRequest, NextResponse } from "next/server";
import { SESSION_TTL_SECONDS } from "@/lib/config";
import { audit, findUserById, getDb, nowIso } from "@/lib/db";
import {
  assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson, safeNextPath,
} from "@/lib/http";
import {
  getLinkTicket, getProvider, getProviderLinkByUser, linkProvider, markLinkTicketUsed,
} from "@/lib/login-providers";
import { createSession, sessionCookieOptions } from "@/lib/session";
import { verifyTotp } from "@/lib/totp";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

interface Body {
  ticket?: string;
  code?: string;
  next?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = await readJson<Body>(req);
    const ticket = (body.ticket || "").trim();
    const code = (body.code || "").trim();
    if (!ticket) throw new HttpError(400, "invalid_request", "绑定会话已过期");
    if (!rateLimit(`provider-link-otp:${clientIp(req)}`, 10, 300)) {
      throw new HttpError(429, "rate_limited", "尝试过于频繁，请稍后再试");
    }
    const row = getLinkTicket(ticket, clientIp(req));
    if (!row || !row.user_id) {
      throw new HttpError(401, "link_expired", "绑定会话已过期，请重新发起第三方登录");
    }
    const provider = getProvider(row.provider_id);
    if (!provider || !provider.enabled) throw new HttpError(400, "provider_disabled", "登录服务已停用");
    const user = findUserById(row.user_id);
    if (!user || user.status !== "active") throw new HttpError(403, "account_disabled", "账号已被禁用");
    if (!user.totp_secret) {
      throw new HttpError(400, "totp_disabled", "该账号未启用 TOTP，请重新绑定");
    }
    if (!code) throw new HttpError(400, "otp_required", "请输入动态验证码");
    if (!verifyTotp(user.totp_secret, code)) {
      audit("totp_login_deny", {
        userId: user.id, ip: clientIp(req), detail: "provider_link",
      });
      throw new HttpError(401, "otp_invalid", "动态验证码不正确");
    }
    if (getProviderLinkByUser(user.id, provider.id)) {
      throw new HttpError(409, "already_linked", "该本地账号已绑定其他第三方账户");
    }
    try {
      linkProvider(provider.id, row.subject, user.id);
    } catch {
      throw new HttpError(409, "already_linked", "该第三方账户已绑定其他本地账号");
    }
    markLinkTicketUsed(ticket);
    const token = createSession(user.id, SESSION_TTL_SECONDS);
    getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
    audit("provider_link", {
      userId: user.id, clientId: provider.key, ip: clientIp(req), detail: "totp",
    });
    const options = sessionCookieOptions(SESSION_TTL_SECONDS);
    const res = NextResponse.json({
      ok: true, user: publicUser(user),
      next: safeNextPath(body.next || row.next),
    });
    res.cookies.set(options.name, token, options);
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
