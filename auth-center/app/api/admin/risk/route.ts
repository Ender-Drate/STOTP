import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { getRiskSettings, saveRiskSettings, type RiskSettings } from "@/lib/risk";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await currentUser();
    if (!user) throw new HttpError(401, "unauthorized", "请先登录");
    if (!isSuperAdmin(user)) throw new HttpError(403, "forbidden", "仅最高管理员可以修改风控指标");
    const body = await readJson<Partial<RiskSettings>>(req);
    const settings = saveRiskSettings(body);
    audit("risk_settings_update", {
      userId: user.id, ip: clientIp(req),
      detail: `captcha=${settings.captchaAfterFailures},window=${settings.loginFailWindowSeconds}`,
    });
    return NextResponse.json({ ok: true, settings: getRiskSettings() });
  } catch (error) {
    return errorResponse(error);
  }
}
