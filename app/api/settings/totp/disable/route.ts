import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { audit, getDb } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { verifyPassword } from "@/lib/crypto";
import { decryptPasswordField } from "@/lib/password-crypto";

export const runtime = "nodejs";

interface Body {
  password?: string;
  password_enc?: string;
  password_key?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson<Body>(req);
    const password = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    if (!verifyPassword(password || "", user.password_hash)) {
      throw new HttpError(400, "invalid_credentials", "当前密码不正确");
    }
    getDb().prepare("UPDATE users SET totp_secret = NULL WHERE id = ?").run(user.id);
    audit("totp_disable", { userId: user.id, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
