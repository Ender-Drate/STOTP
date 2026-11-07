import { NextRequest, NextResponse } from "next/server";
import { SESSION_TTL_SECONDS, STOTP_ENABLED } from "@/lib/config";
import { verifyPassword } from "@/lib/crypto";
import { audit, findUserById, findUserByUsername, getDb, nowIso } from "@/lib/db";
import {
  assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson, safeNextPath,
} from "@/lib/http";
import {
  getLinkTicket, getProviderLinkByUser, getProvider, linkProvider, markLinkTicketUsed,
  setLinkTicketUser,
} from "@/lib/login-providers";
import { createSession, sessionCookieOptions } from "@/lib/session";
import { getBinding } from "@/lib/stotp-store";
import { isIpBlocked } from "@/lib/ip-rules";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

interface Body {
  ticket?: string;
  username?: string;
  password?: string;
  next?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    if (isIpBlocked(clientIp(req))) throw new HttpError(403, "ip_blocked", "当前 IP 已被限制");
    const body = await readJson<Body>(req);
    const ticket = (body.ticket || "").trim();
    const identifier = (body.username || "").trim();
    const password = body.password || "";
    if (!ticket) throw new HttpError(400, "invalid_request", "绑定会话已过期");
    if (!rateLimit(`provider-link:${clientIp(req)}`, 10, 300)) {
      throw new HttpError(429, "rate_limited", "尝试过于频繁，请稍后再试");
    }
    const row = getLinkTicket(ticket, clientIp(req));
    if (!row) throw new HttpError(401, "link_expired", "绑定会话已过期，请重新发起第三方登录");
    const provider = getProvider(row.provider_id);
    if (!provider || !provider.enabled) throw new HttpError(400, "provider_disabled", "登录服务已停用");
    const user = findUserByUsername(identifier);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, "invalid_credentials", "本地账号或密码不正确");
    }
    if (user.status !== "active") throw new HttpError(403, "account_disabled", "账号已被禁用");
    const existing = getProviderLinkByUser(user.id, provider.id);
    if (existing) {
      throw new HttpError(409, "already_linked", "该本地账号已绑定其他第三方账户");
    }
    if (user.totp_secret) {
      setLinkTicketUser(ticket, user.id);
      return NextResponse.json({
        ok: false,
        otp_required: true,
        method: "totp",
        ticket,
        next: safeNextPath(body.next || row.next),
      });
    }
    if (getBinding(user.id)) {
      throw new HttpError(403, "stotp_required",
        STOTP_ENABLED
          ? "该账号启用了 STOTP，请先在设置中解除旧版绑定后再绑定第三方账户"
          : "该账号存在旧版 STOTP 绑定，当前无法绑定第三方账户");
    }
    try {
      linkProvider(provider.id, row.subject, user.id);
    } catch {
      throw new HttpError(409, "already_linked", "该第三方账户已绑定其他本地账号");
    }
    markLinkTicketUsed(ticket);
    const token = createSession(user.id, SESSION_TTL_SECONDS, {
      ip: clientIp(req), userAgent: req.headers.get("user-agent") || "",
    });
    getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
      .run(nowIso(), user.id);
    audit("provider_link", {
      userId: user.id, clientId: provider.key, ip: clientIp(req),
    });
    const options = sessionCookieOptions(SESSION_TTL_SECONDS);
    const res = NextResponse.json({
      ok: true, user: publicUser(findUserById(user.id)!),
      next: safeNextPath(body.next || row.next),
    });
    res.cookies.set(options.name, token, options);
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
