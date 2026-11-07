import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL } from "@/lib/config";
import { audit, findUserById, getDb } from "@/lib/db";
import { requireUser } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { publicUser } from "@/lib/users";
import { email, optionalText } from "@/lib/validators";

export const runtime = "nodejs";

interface Body {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
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
    try {
      const emailChanged = mail !== user.email;
      getDb().prepare(
        `UPDATE users SET display_name = ?, email = ?, avatar_url = ?,
           email_verified = CASE WHEN ? THEN 0 ELSE email_verified END
         WHERE id = ?`
      ).run(displayName, mail, avatarUrl, emailChanged ? 1 : 0, user.id);
    } catch {
      throw new HttpError(409, "already_exists", "邮箱已被其他账号使用");
    }
    audit("profile_update", { userId: user.id, ip: clientIp(req) });
    return NextResponse.json({ user: publicUser(findUserById(user.id)!) });
  } catch (error) {
    return errorResponse(error);
  }
}
