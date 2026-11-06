import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse } from "@/lib/http";
import { removeBinding } from "@/lib/stotp-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    removeBinding(user.id);
    audit("stotp_unbind", { userId: user.id, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
