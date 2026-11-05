import { NextResponse } from "next/server";
import { jwks } from "@/lib/jwt";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(jwks(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json",
    },
  });
}
