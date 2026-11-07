import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { assertSameOrigin, errorResponse, HttpError } from "@/lib/http";
import { deletePasskey } from "@/lib/passkeys";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await context.params;
    if (!deletePasskey(user.id, Number(id))) {
      throw new HttpError(404, "not_found", "Passkey 不存在");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
