import { NextRequest, NextResponse } from "next/server";
import { audit, findUserByUsername } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { sha256 } from "@/lib/crypto";
import { verifyCaptcha, CAPTCHA_COOKIE } from "@/lib/captcha";
import { email } from "@/lib/validators";
import { accountRisk } from "@/lib/account-risk";
import { issuePasswordReset } from "@/lib/password-reset";
import { issueEmailVerification } from "@/lib/email-verification";
import { mailConfigured, sendPasswordResetEmail, sendVerificationEmail } from "@/lib/mailer";

export const runtime = "nodejs";

interface Body {
  email?: string;
  captchaCode?: string;
}

const E2E = process.env.AUTH_E2E === "1";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    if (!rateLimit(`forgot:${ip}`, 5, 900)
      || !rateLimit("forgot:global", 100, 900)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁，请稍后再试");
    }
    const body = await readJson<Body>(req);
    const mail = email(body.email);
    if (!rateLimit(`forgot-email:${sha256(mail)}`, 3, 900)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁，请稍后再试");
    }
    if (!E2E) {
      const token = req.cookies.get(CAPTCHA_COOKIE)?.value || "";
      const code = body.captchaCode || "";
      if (!token || !code) {
        throw new HttpError(400, "captcha_required", "请输入图形验证码", {
          captcha_required: true,
        });
      }
      if (!verifyCaptcha(token, code, ip, "forgot-password")) {
        throw new HttpError(400, "captcha_invalid", "图形验证码不正确", {
          captcha_required: true,
        });
      }
    }
    if (!mailConfigured()) {
      throw new HttpError(503, "mail_unavailable", "邮件服务未配置，请联系管理员");
    }

    const user = findUserByUsername(mail);
    let testToken: string | undefined;
    if (user) {
      if (user.status === "pending") {
        const token = issueEmailVerification(user.id);
        try {
          await sendVerificationEmail(user.email, token);
        } catch (error) {
          console.error("[auth-center] forgot verification email failed", error);
        }
        if (E2E) testToken = token;
      } else if (user.status === "active") {
        const risk = accountRisk(user, ip);
        const token = issuePasswordReset(user.id, risk.level);
        try {
          await sendPasswordResetEmail(user.email, token, risk.level);
        } catch (error) {
          console.error("[auth-center] reset email failed", error);
        }
        audit("password_reset_request", {
          userId: user.id,
          ip,
          detail: `${risk.level}:${risk.score}`,
        });
        if (E2E) testToken = token;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        message: "如果该邮箱已注册，重置邮件已发送，请检查收件箱和垃圾邮件",
        ...(testToken ? { testToken } : {}),
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
