import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { mailConfigured, saveSmtpConfig, smtpView } from "@/lib/mailer";

export const runtime = "nodejs";

async function superadmin() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "unauthorized", "请先登录");
  if (!isSuperAdmin(user)) throw new HttpError(403, "forbidden", "仅最高管理员可以配置 SMTP");
  return user;
}

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json({ config: smtpView(), ready: mailConfigured() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await superadmin();
    if (!rateLimit(`smtp-save:${user.id}`, 10, 300)) {
      throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后再试");
    }
    const body = await readJson<{
      host?: string; port?: number; secure?: boolean;
      user?: string; from?: string; password?: string;
    }>(req);
    const host = (body.host || "").trim();
    const port = Number(body.port || 465);
    const secure = body.secure !== false;
    const smtpUser = (body.user || "").trim();
    const from = (body.from || "").trim();
    if (!host || /\s|:\/\//.test(host)) {
      throw new HttpError(400, "invalid_request", "SMTP 主机不合法");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new HttpError(400, "invalid_request", "SMTP 端口不合法");
    }
    if (!smtpUser || !from) {
      throw new HttpError(400, "invalid_request", "SMTP 用户名和发件人不能为空");
    }
    try {
      saveSmtpConfig({
        host, port, secure, user: smtpUser, from,
        password: body.password || undefined,
      });
    } catch {
      throw new HttpError(400, "invalid_request", "SMTP 密码不能为空");
    }
    audit("smtp_update", { userId: user.id, ip: clientIp(req), detail: `${host}:${port}` });
    return NextResponse.json({ ok: true, config: smtpView(), ready: mailConfigured() });
  } catch (error) {
    return errorResponse(error);
  }
}
