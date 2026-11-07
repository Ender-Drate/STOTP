import { NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { errorResponse } from "@/lib/http";
import { listPasskeys } from "@/lib/passkeys";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      passkeys: listPasskeys(user.id).map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.created_at,
        lastUsedAt: item.last_used_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
