import { NextRequest, NextResponse } from "next/server";
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

export const runtime = "nodejs";

interface Body {
  username?: string;
  email?: string;
  password?: string;
  password_enc?: string;
  password_key?: string;
  displayName?: string;
  next?: string;
}

function registerRedirect(next: string, error?: string): NextResponse {
  const url = new URL("/register", PUBLIC_URL);
  url.searchParams.set("next", next);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const formMode = isFormRequest(req);
  let next = "/dashboard";
  try {
    assertSameOrigin(req);
    const body: Body = formMode ? await readForm(req) : await readJson<Body>(req);
    next = safeNextPath(body.next);
    if (!rateLimit(`register:${clientIp(req)}`, 10, 3600)) {
      throw new HttpError(429, "rate_limited", "注册过于频繁，请稍后再试");
    }
    if (isIpBlocked(clientIp(req))) {
      throw new HttpError(403, "ip_blocked", "当前 IP 已被限制");
    }
    const name = username(body.username);
    const mail = email(body.email);
    const pass = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    if (pass.length < 10) throw new HttpError(400, "invalid_request", "密码至少 10 位");
    if (pass.length > 128) throw new HttpError(400, "invalid_request", "密码过长");
    const passwordHash = hashPassword(pass);
    if (findUserByUsername(name) || findUserByUsername(mail)) {
      // 不明确区分用户名/邮箱占用，降低账号枚举质量
      throw new HttpError(400, "invalid_request", "注册信息不可用，请更换用户名或邮箱");
    }
    const now = nowIso();
    const userRole = getRoleByKey("user");
    if (!userRole) throw new HttpError(500, "server_error", "权限等级初始化失败");
    const result = getDb().prepare(
      `INSERT INTO users(username, email, password_hash, display_name, role, role_id,
         status, permissions, created_at)
       VALUES (?,?,?,?, 'user', ?, 'active', ?, ?)`
    ).run(name, mail, passwordHash,
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim().slice(0, 40) : name,
      userRole.id, userRole.permissions, now);
    const userId = Number(result.lastInsertRowid);
    const token = createSession(userId, SESSION_TTL_SECONDS, {
      ip: clientIp(req), userAgent: req.headers.get("user-agent") || "",
    });
    audit("user_register", { userId, ip: clientIp(req) });
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
