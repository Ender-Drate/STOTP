import { NextRequest, NextResponse } from "next/server";
import { currentSessionId, currentUser, listUserSessions, revokeOtherSessions } from "@/lib/session";
import { assertSameOrigin, clientIp, errorResponse } from "@/lib/http";
import { audit } from "@/lib/db";

export const runtime = "nodejs";

function view(session: ReturnType<typeof listUserSessions>[number], currentId: string | null) {
  return {
    id: session.id,
    current: session.id === currentId,
    ip: session.ip,
    userAgent: session.user_agent,
    createdAt: new Date(session.created_at * 1000).toISOString(),
    lastSeenAt: session.last_seen_at
      ? new Date(session.last_seen_at * 1000).toISOString() : null,
    expiresAt: new Date(session.expires_at * 1000).toISOString(),
  };
}

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ sessions: [] }, { status: 401 });
    const currentId = await currentSessionId();
    return NextResponse.json({
      sessions: listUserSessions(user.id).map((session) => view(session, currentId)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });
    const currentId = await currentSessionId();
    const count = revokeOtherSessions(user.id, currentId);
    audit("sessions_revoke_others", {
      userId: user.id, ip: clientIp(req), detail: String(count),
    });
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return errorResponse(error);
  }
}
