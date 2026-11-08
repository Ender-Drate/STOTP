import { NextRequest, NextResponse } from "next/server";
import { findUserById, getDb, audit } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { decryptPasswordField } from "@/lib/password-crypto";
import { verifyCaptcha } from "@/lib/captcha";
import { requireSecondFactor } from "@/lib/reauth";
import { bumpAccountRisk } from "@/lib/account-risk";
import { consumePasswordReset, peekPasswordReset } from "@/lib/password-reset";

export const runtime = "nodejs";

interface Body {
  token?: string;
  password?: string;
  password_enc?: string;
  password_key?: string;
  code?: string;
  captchaTicket?: string;
  captchaCode?: string;
}

const E2E = process.env.AUTH_E2E === "1";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    if (!rateLimit(`reset:${ip}`, 10, 900)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁，请稍后再试");
    }
    const body = await readJson<Body>(req);
    const record = peekPasswordReset(body.token || "");
    if (!record) {
      throw new HttpError(400, "invalid_token", "重置链接无效或已过期");
    }
    if (!rateLimit(`reset-token:${record.token_hash}`, 5, 900)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁，请稍后再试");
    }
    const user = findUserById(record.user_id);
    if (!user || user.status !== "active") {
      throw new HttpError(400, "invalid_user", "账号不可用");
    }
    const highRisk = record.risk_level === "high" || record.risk_level === "critical";
    if (highRisk) {
      if (user.totp_secret) {
        requireSecondFactor(user, body.code || "", "password_reset");
      } else if (!E2E) {
        const ticket = body.captchaTicket || "";
        const code = body.captchaCode || "";
        if (!ticket || !code) {
          throw new HttpError(400, "captcha_required", "高风险请求需要图形验证码", {
            captcha_required: true,
          });
        }
        if (!verifyCaptcha(ticket, code, ip)) {
          throw new HttpError(400, "captcha_invalid", "图形验证码不正确", {
            captcha_required: true,
          });
        }
      }
    }
    const next = decryptPasswordField(
      body.password, body.password_enc, body.password_key, "新密码",
    );
    if (next.length < 10) {
      throw new HttpError(400, "invalid_request", "新密码至少 10 位");
    }
    if (!consumePasswordReset(body.token || "")) {
      throw new HttpError(400, "invalid_token", "重置链接已被使用，请重新发起");
    }

    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .run(hashPassword(next), user.id);
      // 密码重置本身是风险事件：至少提升到 high（85），之后按天衰减。
      bumpAccountRisk(user.id, 85);
      db.prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ?").run(user.id);
      for (const table of [
        "sessions", "passkeys", "provider_links", "provider_link_tickets",
        "login_challenges", "webauthn_challenges", "totp_pending",
        "password_reset_tokens", "email_verification_tokens",
      ]) {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    audit("password_reset", {
      userId: user.id, ip, detail: record.risk_level,
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
