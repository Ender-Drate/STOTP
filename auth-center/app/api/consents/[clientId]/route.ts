import { NextRequest, NextResponse } from "next/server";
import { audit, getDb } from "@/lib/db";
import { requireUser } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ clientId: string }> }
) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { clientId } = await context.params;
    const db = getDb();
    db.prepare("DELETE FROM consents WHERE user_id = ? AND client_id = ?")
      .run(user.id, clientId);
    db.prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?")
      .run(user.id, clientId);
    audit("consent_revoke", { userId: user.id, clientId, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
