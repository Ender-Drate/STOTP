import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/config";
import { audit, findUserById, getDb } from "@/lib/db";
import { requireUser } from "@/lib/admin";
import { hashPassword, sha256, verifyPassword } from "@/lib/crypto";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";

export const runtime = "nodejs";

interface Body {
  currentPassword?: string;
  newPassword?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson<Body>(req);
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!verifyPassword(current, user.password_hash)) {
      throw new HttpError(400, "invalid_credentials", "当前密码不正确");
    }
    if (next.length < 8) throw new HttpError(400, "invalid_request", "新密码至少 8 位");
    getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(hashPassword(next), user.id);
    // 修改密码后使其它会话失效，保留当前会话
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      getDb().prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
        .run(user.id, sha256(token));
    }
    audit("password_change", { userId: user.id, ip: clientIp(req) });
    const updated = findUserById(user.id)!;
    return NextResponse.json({ ok: true, user: updated.id });
  } catch (error) {
    return errorResponse(error);
  }
}
