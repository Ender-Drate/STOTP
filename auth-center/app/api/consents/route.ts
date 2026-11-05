import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/admin";
import { errorResponse } from "@/lib/http";
import { parseScopes } from "@/lib/oidc";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = getDb().prepare(
      `SELECT c.client_id, c.name, c.description, s.scope, s.created_at
       FROM consents s JOIN oauth_clients c ON c.client_id = s.client_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC`
    ).all(user.id) as unknown as Array<{
      client_id: string; name: string; description: string | null;
      scope: string; created_at: string;
    }>;
    return NextResponse.json({
      consents: rows.map((row) => ({
        clientId: row.client_id,
        clientName: row.name,
        description: row.description,
        scopes: parseScopes(row.scope),
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
