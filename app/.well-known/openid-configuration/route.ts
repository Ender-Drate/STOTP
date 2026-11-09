import { NextResponse } from "next/server";
import { discoveryDocument } from "@/lib/oidc-discovery";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(discoveryDocument(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
