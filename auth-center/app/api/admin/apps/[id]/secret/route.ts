import { NextRequest, NextResponse } from "next/server";
import { audit, getDb, type OAuthClient } from "@/lib/db";
import { requirePermission } from "@/lib/admin";
import { newClientSecret, sha256 } from "@/lib/crypto";
import { assertSameOrigin, clientIp, errorResponse, HttpError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const admin = await requirePermission("oauth.apps.manage");
    const { id } = await context.params;
    const client = getDb().prepare("SELECT * FROM oauth_clients WHERE id = ?")
      .get(Number(id)) as unknown as OAuthClient | undefined;
    if (!client) throw new HttpError(404, "not_found", "应用不存在");
    if (client.is_public) throw new HttpError(400, "invalid_request", "公共客户端没有密钥");
    const secret = newClientSecret();
    getDb().prepare("UPDATE oauth_clients SET client_secret_hash = ? WHERE id = ?")
      .run(sha256(secret), client.id);
    audit("client_secret_rotate", {
      userId: admin.id, clientId: client.client_id, ip: clientIp(req),
    });
    return NextResponse.json({ clientSecret: secret });
  } catch (error) {
    return errorResponse(error);
  }
}
