import { NextRequest, NextResponse } from "next/server";
import { findUserById } from "@/lib/db";

export const runtime = "nodejs";

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c] as string));
}

function color(seed: number): string {
  const palette = ["#0071e3", "#5e5ce6", "#30b0c7", "#ff9500", "#ff375f", "#34c759"];
  return palette[Math.abs(seed) % palette.length];
}

export async function GET(req: NextRequest) {
  const uid = Number(req.nextUrl.searchParams.get("uid") || 0);
  const user = uid ? findUserById(uid) : undefined;
  if (!user) return new NextResponse("Not Found", { status: 404 });
  if (user.avatar_url) return NextResponse.redirect(user.avatar_url, 302);
  const initial = escapeXml((user.display_name || user.username).slice(0, 1).toUpperCase());
  const background = color(user.id);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <rect width="160" height="160" rx="36" fill="${background}"/>
  <text x="80" y="104" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif"
    font-size="72" font-weight="600" fill="#fff" text-anchor="middle">${initial}</text>
</svg>`;
  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
  });
}
