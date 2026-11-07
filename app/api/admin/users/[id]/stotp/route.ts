import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin";
import { audit, findUserById } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError } from "@/lib/http";
import { removeBinding } from "@/lib/stotp-store";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const admin = await requirePermission("stotp.manage");
    const { id } = await context.params;
    const user = findUserById(Number(id));
    if (!user) throw new HttpError(404, "not_found", "用户不存在");
    const removed = removeBinding(user.id);
    audit("stotp_unbind", {
      userId: admin.id, ip: clientIp(req), detail: `target=${user.id}`,
    });
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    return errorResponse(error);
  }
}
