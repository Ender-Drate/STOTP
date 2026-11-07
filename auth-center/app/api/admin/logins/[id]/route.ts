import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { requirePermission } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import {
  deleteProvider, getProvider, providerIconUrl, providerView, providerUrl,
  updateProvider, type ProviderBody,
} from "@/lib/login-providers";
import { optionalText, text } from "@/lib/validators";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const admin = await requirePermission("login.providers.manage");
    const { id } = await context.params;
    const provider = getProvider(Number(id));
    if (!provider) throw new HttpError(404, "not_found", "登录服务不存在");
    const body = await readJson<ProviderBody>(req);
    updateProvider(provider.id, {
      name: text(body.name ?? provider.name, "登录服务名称", 2, 40),
      iconUrl: body.iconUrl === undefined ? provider.icon_url : providerIconUrl(body.iconUrl),
      clientId: text(body.clientId ?? provider.client_id, "Client ID", 1, 200),
      clientSecret: body.clientSecret ? text(body.clientSecret, "Client Secret", 1, 300) : undefined,
      authorizationUrl: providerUrl(body.authorizationUrl ?? provider.authorization_url, "授权地址"),
      tokenUrl: providerUrl(body.tokenUrl ?? provider.token_url, "Token 地址"),
      userinfoUrl: providerUrl(body.userinfoUrl ?? provider.userinfo_url, "UserInfo 地址"),
      scopes: optionalText(body.scopes ?? provider.scopes, 300) || provider.scopes,
      enabled: body.enabled === undefined ? Boolean(provider.enabled) : Boolean(body.enabled),
    });
    audit("provider_update", {
      userId: admin.id, ip: clientIp(req), detail: `provider=${provider.key}`,
    });
    return NextResponse.json({ provider: providerView(getProvider(provider.id)!) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const admin = await requirePermission("login.providers.manage");
    const { id } = await context.params;
    const provider = getProvider(Number(id));
    if (!provider) throw new HttpError(404, "not_found", "登录服务不存在");
    deleteProvider(provider.id);
    audit("provider_delete", {
      userId: admin.id, ip: clientIp(req), detail: `provider=${provider.key}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
