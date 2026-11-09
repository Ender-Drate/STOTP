import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL } from "@/lib/config";
import { audit, findUserById, getDb, nowIso } from "@/lib/db";
import { requireUser } from "@/lib/admin";
import {
  assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson,
} from "@/lib/http";
import { decryptPasswordField } from "@/lib/password-crypto";
import { requireCurrentPassword, requireSecondFactor } from "@/lib/reauth";
import { issueEmailVerification } from "@/lib/email-verification";
import { mailConfigured, sendEmailChangedEmail, sendVerificationEmail } from "@/lib/mailer";
import { sessionCookieOptions } from "@/lib/session";
import { publicUser } from "@/lib/users";
import { email, optionalText } from "@/lib/validators";

export const runtime = "nodejs";
const E2E = process.env.AUTH_E2E === "1";

interface Body {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  currentPassword?: string;
  currentPassword_enc?: string;
  password_key?: string;
  code?: string;
}

export async function PATCH(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson<Body>(req);
    const displayName = body.displayName === undefined
      ? user.display_name
      : optionalText(body.displayName, 40) ?? user.username;
    const mail = body.email === undefined ? user.email : email(body.email);
    const emailChanged = mail.toLowerCase() !== user.email.toLowerCase();
    let avatarUrl = user.avatar_url;
    if (body.avatarUrl !== undefined) {
      const value = (body.avatarUrl || "").trim();
      if (value) {
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          throw new HttpError(400, "invalid_request", "头像地址不合法");
        }
        if (!["http:", "https:"].includes(parsed.protocol)) {
          throw new HttpError(400, "invalid_request", "头像只支持 http/https");
        }
        if (parsed.origin !== new URL(PUBLIC_URL).origin) {
          throw new HttpError(400, "invalid_request", "头像只允许本站地址，避免第三方追踪");
        }
        avatarUrl = value;
      } else {
        avatarUrl = null;
      }
    }

    if (emailChanged) {
      if (!E2E && !mailConfigured()) {
        throw new HttpError(503, "mail_unavailable", "邮件服务未配置，暂时无法修改邮箱");
      }
      if (!rateLimit(`profile-email:${user.id}`, 5, 300)) {
        throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后再试");
      }
      const current = decryptPasswordField(
        body.currentPassword, body.currentPassword_enc, body.password_key, "当前密码",
      );
      await requireCurrentPassword(user, current, "email_change");
      await requireSecondFactor(user, body.code || "", "email_change");
    }

    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `UPDATE users SET display_name = ?, email = ?, avatar_url = ?,
           email_verified = CASE WHEN ? THEN 0 ELSE email_verified END
         WHERE id = ?`
      ).run(displayName, mail, avatarUrl, emailChanged ? 1 : 0, user.id);
      if (emailChanged) {
        // 邮箱是找回密码的根凭证，变更后踢掉全部会话和令牌，并作废旧重置链接。
        db.prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ?").run(user.id);
        for (const table of [
          "sessions", "login_challenges", "webauthn_challenges",
          "password_reset_tokens", "email_verification_tokens",
        ]) {
          db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new HttpError(409, "already_exists", "邮箱已被其他账号使用");
    }

    let mailSent = true;
    if (emailChanged) {
      const when = nowIso();
      if (!E2E) {
        try {
          await sendEmailChangedEmail(user.email, mail, when);
        } catch (error) {
          mailSent = false;
          console.error("[auth-center] old-email change notice failed", error);
        }
        try {
          const token = issueEmailVerification(user.id);
          await sendVerificationEmail(mail, token);
        } catch (error) {
          mailSent = false;
          console.error("[auth-center] new-email verification failed", error);
        }
      }
      audit("email_change", {
        userId: user.id, ip: clientIp(req), detail: mailSent ? "notified" : "mail_failed",
      });
    } else {
      audit("profile_update", { userId: user.id, ip: clientIp(req) });
    }

    const updated = findUserById(user.id)!;
    const res = NextResponse.json({
      user: publicUser(updated),
      logout: emailChanged,
      mailSent,
      ...(emailChanged ? { message: "邮箱已修改，请重新登录并验证新邮箱" } : {}),
    });
    if (emailChanged) {
      res.cookies.set({ ...sessionCookieOptions(0), value: "" });
    }
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
