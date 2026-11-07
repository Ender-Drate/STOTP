import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin";
import { audit } from "@/lib/db";
import {
  assertSameOrigin,
  clientIp,
  errorResponse,
  HttpError,
  rateLimit,
  readJson,
} from "@/lib/http";
import { getBindingByClientId, bindingView, saveBinding } from "@/lib/stotp-store";
import { stotpConfigured, stotpLoginVerify, StotpError } from "@/lib/stotp";

export const runtime = "nodejs";

interface Body {
  clientId?: string;
  code?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requirePermission("stotp.bind");
    if (!stotpConfigured()) {
      throw new HttpError(503, "stotp_disabled", "STOTP 未启用，请联系管理员");
    }
    if (!rateLimit(`stotp-bind:${user.id}`, 10, 300)) {
      throw new HttpError(429, "rate_limited", "尝试过于频繁，请稍后再试");
    }
    const body = await readJson<Body>(req);
    const clientId = (body.clientId || "").trim();
    const code = (body.code || "").trim();
    if (!UUID_RE.test(clientId)) {
      throw new HttpError(400, "invalid_request", "client_id 必须是 UUIDv4");
    }
    if (!/^\d{6}$/.test(code)) {
      throw new HttpError(400, "invalid_request", "请输入 6 位验证码");
    }
    const owner = getBindingByClientId(clientId);
    if (owner && owner.user_id !== user.id) {
      throw new HttpError(409, "already_bound", "该设备已绑定到其他账号");
    }

    let result;
    try {
      result = await stotpLoginVerify(clientId, code);
    } catch (error) {
      if (error instanceof StotpError) {
        const status = error.code === "unavailable" || error.code === "disabled" ? 503 : 502;
        throw new HttpError(status, error.code, "STOTP 验证服务暂不可用，请稍后重试");
      }
      throw error;
    }
    if (result.result !== "allow") {
      throw new HttpError(400, "otp_invalid", "验证码不正确或设备不匹配");
    }
    const binding = saveBinding(user.id, clientId, result.claims.sub || null);
    audit("stotp_bind", {
      userId: user.id, clientId, ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, binding: bindingView(binding) });
  } catch (error) {
    return errorResponse(error);
  }
}

