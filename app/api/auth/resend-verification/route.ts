import { NextRequest, NextResponse } from "next/server";
import { audit, findUserByUsername } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { email } from "@/lib/validators";
import { issueEmailVerification } from "@/lib/email-verification";
import { mailConfigured, sendVerificationEmail } from "@/lib/mailer";

export const runtime = "nodejs";

interface Body {
  email?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    if (!rateLimit(`verification-resend:${ip}`, 3, 3600)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁，请稍后再试");
    }
    const body = await readJson<Body>(req);
    const mail = email(body.email);
    if (!mailConfigured()) {
      throw new HttpError(503, "mail_unavailable", "邮件服务未配置，请联系管理员");
    }
    const user = findUserByUsername(mail);
    if (user && user.status === "pending") {
      const token = issueEmailVerification(user.id);
      try {
        await sendVerificationEmail(user.email, token);
        audit("verification_resend", { userId: user.id, ip });
      } catch (error) {
        console.error("[auth-center] resend verification failed", error);
        throw new HttpError(503, "mail_failed", "验证邮件发送失败，请稍后重试");
      }
    }
    // 不暴露邮箱是否存在
    return NextResponse.json(
      { ok: true, message: "如果该邮箱待验证，验证邮件已发送" },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
