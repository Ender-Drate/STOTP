import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse } from "@/lib/http";
import { removeProviderLink } from "@/lib/login-providers";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ providerId: string }> }
) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { providerId } = await context.params;
    if (!removeProviderLink(user.id, Number(providerId))) {
      return NextResponse.json({
        ok: false,
        error: { code: "not_found", message: "未找到该第三方绑定" },
      }, { status: 404 });
    }
    audit("provider_unlink", {
      userId: user.id, ip: clientIp(req), detail: `provider=${providerId}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
