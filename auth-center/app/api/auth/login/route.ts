import { NextRequest, NextResponse } from "next/server";
import { SESSION_TTL_SECONDS } from "@/lib/config";
import { verifyPassword } from "@/lib/crypto";
import { audit, findUserByUsername, getDb, nowIso } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { createSession, sessionCookieOptions } from "@/lib/session";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

interface Body {
  username?: string;
  password?: string;
  remember?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = await readJson<Body>(req);
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
    const ttl = body.remember ? 30 * 24 * 3600 : SESSION_TTL_SECONDS;
    const token = createSession(user.id, ttl);
    getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
    audit("login", { userId: user.id, ip: clientIp(req) });
    const res = NextResponse.json({ ok: true, user: publicUser(user) });
    const options = sessionCookieOptions(ttl);
    res.cookies.set(options.name, token, options);
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
