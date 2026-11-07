import { NextResponse } from "next/server";
import { getPasswordPublicKey } from "@/lib/password-crypto";

export const runtime = "nodejs";

export async function GET() {
  const { kid, key } = getPasswordPublicKey();
  return NextResponse.json(
    { kid, key },
    { headers: { "Cache-Control": "no-store" } }
  );
}
