import { NextRequest, NextResponse } from "next/server";
import { findUserById } from "@/lib/db";
import { verifyAvatarSignature } from "@/lib/avatar";
import { clientIp, rateLimit } from "@/lib/http";

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
  if (!rateLimit(`avatar:${clientIp(req)}`, 120, 60)) {
    return new NextResponse("Too Many Requests", { status: 429 });
  }
  const uid = Number(req.nextUrl.searchParams.get("uid") || 0);
  const signature = req.nextUrl.searchParams.get("sig") || "";
  if (!Number.isInteger(uid) || uid <= 0 || !verifyAvatarSignature(uid, signature)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const user = findUserById(uid);
  if (!user || user.status !== "active") return new NextResponse("Not Found", { status: 404 });

  // 永远不 302 到用户可控的头像 URL；只输出本地生成的 SVG，避免开放跳转和 PII 泄露。
  const initial = escapeXml((user.display_name || user.username).slice(0, 1).toUpperCase());
  const background = color(user.id);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <rect width="160" height="160" rx="36" fill="${background}"/>
  <text x="80" y="104" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif"
    font-size="72" font-weight="600" fill="#fff" text-anchor="middle">${initial}</text>
</svg>`;
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
