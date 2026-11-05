import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, user: null }, { status: 401 });
  return NextResponse.json({ ok: true, user: publicUser(user) });
}
