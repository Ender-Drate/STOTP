import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { sendTestEmail } from "@/lib/mailer";
import { email } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await currentUser();
    if (!user) throw new HttpError(401, "unauthorized", "请先登录");
    if (!isSuperAdmin(user)) throw new HttpError(403, "forbidden", "仅最高管理员可以测试 SMTP");
    if (!rateLimit(`smtp-test:${user.id}`, 5, 300)) {
      throw new HttpError(429, "rate_limited", "测试过于频繁，请稍后再试");
    }
    const body = await readJson<{ to?: string }>(req);
    const to = email(body.to);
    let messageId: string;
    try {
      messageId = await sendTestEmail(to);
    } catch (error) {
      console.error("[auth-center] smtp test failed", error);
      throw new HttpError(502, "smtp_failed", "邮件发送失败，请检查 SMTP 配置");
    }
    audit("smtp_test", { userId: user.id, ip: clientIp(req), detail: to });
    return NextResponse.json({ ok: true, messageId });
  } catch (error) {
    return errorResponse(error);
  }
}
