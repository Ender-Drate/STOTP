import { NextRequest, NextResponse } from "next/server";
import { audit, getDb, nowIso, type OAuthClient, type User } from "@/lib/db";
import { newClientId, newClientSecret, sha256 } from "@/lib/crypto";
import { requireAdmin } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { parseScopes, SUPPORTED_SCOPES } from "@/lib/oidc";
import { serializeClient } from "@/lib/clients";
import { optionalText, redirectUri, text } from "@/lib/validators";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const rows = getDb().prepare(
      "SELECT * FROM oauth_clients ORDER BY id DESC"
    ).all() as unknown as OAuthClient[];
    return NextResponse.json({ clients: rows.map(serializeClient) });
  } catch (error) {
    return errorResponse(error);
  }
}

interface CreateBody {
  name?: string;
  description?: string;
  redirectUris?: string[];
  scopes?: string[];
  isPublic?: boolean;
}

function scopesFrom(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const scopes = parseScopes(value.filter((item) => typeof item === "string").join(" "));
  if (!scopes.length) throw new HttpError(400, "invalid_request", "至少选择一个 scope");
  if (!scopes.every((scope) => SUPPORTED_SCOPES.includes(scope as never))) {
    throw new HttpError(400, "invalid_request", "包含不支持的 scope");
  }
  return scopes;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await readJson<CreateBody>(req);
    const name = text(body.name, "应用名称", 2, 60);
    const description = optionalText(body.description, 200);
    const uris = Array.isArray(body.redirectUris) ? body.redirectUris : [];
    if (!uris.length) throw new HttpError(400, "invalid_request", "至少填写一个回调地址");
    if (uris.length > 10) throw new HttpError(400, "invalid_request", "回调地址最多 10 个");
    const redirectUris = uris.map(redirectUri);
    const scopes = scopesFrom(body.scopes, ["openid", "profile", "email"]);
    const isPublic = Boolean(body.isPublic);
    const clientId = newClientId();
    const secret = isPublic ? null : newClientSecret();
    const now = nowIso();
    getDb().prepare(
      `INSERT INTO oauth_clients(client_id, client_secret_hash, name, description,
        redirect_uris, scopes, is_public, status, owner_id, created_at)
       VALUES (?,?,?,?,?,?,?, 'active', ?, ?)`
    ).run(clientId, secret ? sha256(secret) : null, name, description,
      JSON.stringify(redirectUris), scopes.join(" "), isPublic ? 1 : 0, admin.id, now);
    audit("client_create", { userId: admin.id, clientId, ip: clientIp(req) });
    const row = getDb().prepare(
      "SELECT * FROM oauth_clients WHERE client_id = ?"
    ).get(clientId) as unknown as OAuthClient;
    return NextResponse.json(
      { client: serializeClient(row), clientSecret: secret },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
