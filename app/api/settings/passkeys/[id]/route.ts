import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { assertSameOrigin, errorResponse, HttpError, readJson } from "@/lib/http";
import { decryptPasswordField } from "@/lib/password-crypto";
import { requireCurrentPassword, requireSecondFactor } from "@/lib/reauth";
import { deletePasskey } from "@/lib/passkeys";

export const runtime = "nodejs";

interface Body {
  code?: string;
  password?: string;
  password_enc?: string;
  password_key?: string;
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson<Body>(req);
    const password = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    requireCurrentPassword(user, password, "passkey_delete");
    requireSecondFactor(user, body.code || "", "passkey_delete");
    const { id } = await context.params;
    if (!deletePasskey(user.id, Number(id))) {
      throw new HttpError(404, "not_found", "Passkey 不存在");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
