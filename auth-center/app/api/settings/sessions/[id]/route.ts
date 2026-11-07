import { NextRequest, NextResponse } from "next/server";
import { currentSessionId, currentUser, revokeSession, sessionCookieOptions } from "@/lib/session";
import { assertSameOrigin, clientIp, errorResponse, HttpError } from "@/lib/http";
import { audit } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(req);
    const user = await currentUser();
    if (!user) throw new HttpError(401, "unauthorized", "请先登录");
    const currentId = await currentSessionId();
    const { id } = await context.params;
    if (!revokeSession(user.id, id)) {
      throw new HttpError(404, "not_found", "会话不存在");
    }
    audit("session_revoke", {
      userId: user.id, ip: clientIp(req), detail: id === currentId ? "current" : "other",
    });
    const res = NextResponse.json({ ok: true, current: id === currentId });
    if (id === currentId) {
      const options = sessionCookieOptions(0);
      res.cookies.set(options.name, "", { ...options, maxAge: 0 });
    }
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
