import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { audit } from "@/lib/db";
import {
  assertSameOrigin, errorResponse, HttpError, rateLimit, readJson,
} from "@/lib/http";
import { requireSecondFactor } from "@/lib/reauth";
import { cloneDefaultCsp, readCspConfig, saveCspConfig } from "@/lib/csp";

export const runtime = "nodejs";

async function superAdmin() {
  const user = await currentUser();
  if (!user || !isSuperAdmin(user)) {
    throw new HttpError(403, "forbidden", "只有最高管理员可以编辑 CSP");
  }
  return user;
}

export async function GET() {
  try {
    const user = await superAdmin();
    return NextResponse.json({
      directives: readCspConfig(),
      defaults: cloneDefaultCsp(),
      totpEnabled: Boolean(user.totp_secret),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await superAdmin();
    if (!user.totp_secret) {
      throw new HttpError(403, "totp_required", "请先在设置中绑定 TOTP，再编辑 CSP");
    }
    if (!rateLimit(`csp-update:${user.id}`, 10, 300)) {
      throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后再试");
    }
    const body = await readJson<{ directives?: unknown; code?: string }>(req);
    await requireSecondFactor(user, body.code || "", "csp_update");
    const directives = saveCspConfig(body.directives);
    audit("csp_update", {
      userId: user.id,
      detail: directives.map((item) => item.name).join(","),
    });
    return NextResponse.json({ ok: true, directives });
  } catch (error) {
    return errorResponse(error);
  }
}
