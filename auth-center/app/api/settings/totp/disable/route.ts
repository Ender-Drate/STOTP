import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { audit, getDb } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { verifyPassword } from "@/lib/crypto";

export const runtime = "nodejs";

interface Body {
  password?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson<Body>(req);
    if (!verifyPassword(body.password || "", user.password_hash)) {
      throw new HttpError(400, "invalid_credentials", "当前密码不正确");
    }
    getDb().prepare("UPDATE users SET totp_secret = NULL WHERE id = ?").run(user.id);
    audit("totp_disable", { userId: user.id, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
