import { NextRequest, NextResponse } from "next/server";
import { SESSION_TTL_SECONDS } from "@/lib/config";
import { hashPassword } from "@/lib/crypto";
import { audit, findUserByUsername, getDb, nowIso } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { createSession, sessionCookieOptions } from "@/lib/session";
import { publicUser } from "@/lib/users";
import { email, username } from "@/lib/validators";

export const runtime = "nodejs";

interface Body {
  username?: string;
  email?: string;
  password?: string;
  displayName?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    if (!rateLimit(`register:${clientIp(req)}`, 10, 3600)) {
      throw new HttpError(429, "rate_limited", "注册过于频繁，请稍后再试");
    }
    const body = await readJson<Body>(req);
    const name = username(body.username);
    const mail = email(body.email);
    const pass = typeof body.password === "string" ? body.password : "";
    if (pass.length < 8) throw new HttpError(400, "invalid_request", "密码至少 8 位");
    if (pass.length > 128) throw new HttpError(400, "invalid_request", "密码过长");
    if (findUserByUsername(name) || findUserByUsername(mail)) {
      throw new HttpError(409, "already_exists", "用户名或邮箱已被占用");
    }
    const now = nowIso();
    const result = getDb().prepare(
      `INSERT INTO users(username, email, password_hash, display_name, role, status, permissions, created_at)
       VALUES (?,?,?,?, 'user', 'active', ?, ?)`
    ).run(name, mail, hashPassword(pass),
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim().slice(0, 40) : name,
      JSON.stringify(["user"]), now);
    const userId = Number(result.lastInsertRowid);
    const token = createSession(userId, SESSION_TTL_SECONDS);
    audit("user_register", { userId, ip: clientIp(req) });
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId);
    const res = NextResponse.json({ ok: true, user: publicUser(user as never) });
    const options = sessionCookieOptions(SESSION_TTL_SECONDS);
    res.cookies.set(options.name, token, options);
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
