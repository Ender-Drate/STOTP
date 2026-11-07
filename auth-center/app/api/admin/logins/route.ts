import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { requirePermission } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, readJson } from "@/lib/http";
import {
  createProvider, listProviders, providerView, providerIconUrl, providerUrl,
  type ProviderBody,
} from "@/lib/login-providers";
import { optionalText, text } from "@/lib/validators";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("login.providers.manage");
    return NextResponse.json({ providers: listProviders().map(providerView) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const admin = await requirePermission("login.providers.manage");
    const body = await readJson<ProviderBody>(req);
    const name = text(body.name, "登录服务名称", 2, 40);
    const clientId = text(body.clientId, "Client ID", 1, 200);
    const clientSecret = text(body.clientSecret, "Client Secret", 1, 300);
    const authorizationUrl = providerUrl(body.authorizationUrl, "授权地址");
    const tokenUrl = providerUrl(body.tokenUrl, "Token 地址");
    const userinfoUrl = providerUrl(body.userinfoUrl, "UserInfo 地址");
    const scopes = optionalText(body.scopes, 300) || "openid profile email";
    const provider = createProvider({
      name,
      iconUrl: providerIconUrl(body.iconUrl),
      clientId,
      clientSecret,
      authorizationUrl,
      tokenUrl,
      userinfoUrl,
      scopes,
      enabled: body.enabled !== false,
    });
    audit("provider_create", {
      userId: admin.id, ip: clientIp(req), detail: `provider=${provider.key}`,
    });
    return NextResponse.json({ provider: providerView(provider) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
