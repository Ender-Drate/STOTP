import { NextRequest, NextResponse } from "next/server";
import { audit, getDb, type OAuthClient } from "@/lib/db";
import { requirePermission } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { parseScopes, SUPPORTED_SCOPES } from "@/lib/oidc";
import { serializeClient } from "@/lib/clients";
import { optionalText, redirectUri, text } from "@/lib/validators";

export const runtime = "nodejs";

async function loadClient(id: string): Promise<OAuthClient> {
  const row = getDb().prepare("SELECT * FROM oauth_clients WHERE id = ?")
    .get(Number(id)) as unknown as OAuthClient | undefined;
  if (!row) throw new HttpError(404, "not_found", "应用不存在");
  return row;
}

interface PatchBody {
  name?: string;
  description?: string;
  redirectUris?: string[];
  scopes?: string[];
  status?: string;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const admin = await requirePermission("oauth.apps.manage");
    const { id } = await context.params;
    const client = await loadClient(id);
    const body = await readJson<PatchBody>(req);

    const name = body.name === undefined ? client.name : text(body.name, "应用名称", 2, 60);
    const description = body.description === undefined
      ? client.description : optionalText(body.description, 200);
    const uris = body.redirectUris === undefined
      ? (JSON.parse(client.redirect_uris) as string[])
      : body.redirectUris.map(redirectUri);
    if (!uris.length) throw new HttpError(400, "invalid_request", "至少保留一个回调地址");
    let scopes = parseScopes(client.scopes);
    if (body.scopes !== undefined) {
      scopes = parseScopes(body.scopes.join(" "));
      if (!scopes.length ||
        !scopes.every((scope) => (SUPPORTED_SCOPES as readonly string[]).includes(scope))) {
        throw new HttpError(400, "invalid_request", "包含不支持的 scope");
      }
    }
    const status = body.status === undefined ? client.status : body.status;
    if (!["active", "disabled"].includes(status)) {
      throw new HttpError(400, "invalid_request", "状态不合法");
    }
    getDb().prepare(
      `UPDATE oauth_clients SET name = ?, description = ?, redirect_uris = ?,
       scopes = ?, status = ? WHERE id = ?`
    ).run(name, description, JSON.stringify(uris), scopes.join(" "), status, client.id);
    audit("client_update", { userId: admin.id, clientId: client.client_id, ip: clientIp(req) });
    return NextResponse.json({ client: serializeClient(await loadClient(id)) });
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
    const admin = await requirePermission("oauth.apps.manage");
    const { id } = await context.params;
    const client = await loadClient(id);
    const db = getDb();
    db.prepare("DELETE FROM oauth_clients WHERE id = ?").run(client.id);
    db.prepare("DELETE FROM tokens WHERE client_id = ?").run(client.client_id);
    db.prepare("DELETE FROM auth_codes WHERE client_id = ?").run(client.client_id);
    db.prepare("DELETE FROM consents WHERE client_id = ?").run(client.client_id);
    audit("client_delete", { userId: admin.id, clientId: client.client_id, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
