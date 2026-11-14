import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const COOKIE = "ac_captcha";

export async function fetchCaptcha(base, purpose) {
  const res = await fetch(`${base}/api/auth/captcha?purpose=${encodeURIComponent(purpose)}&lang=zh`, {
    redirect: "manual",
    headers: { Accept: "application/json" },
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const rawCookie = setCookies
    .find((item) => item.startsWith(`${COOKIE}=`)) || "";
  const cookie = rawCookie.split(";")[0];
  const body = await res.json().catch(() => null);
  return { res, body, cookie, httpOnly: /;\s*HttpOnly/i.test(rawCookie) };
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Solve a challenge from the local SQLite database. This is test-only: the
 * production API never exposes the target geometry or the answer to the client.
 */
export function solveFromDb(cookie) {
  const token = cookie.split("=")[1] || "";
  if (!token) throw new Error("missing captcha cookie");
  const dbPath = process.env.AUTH_DB_PATH
    || join(process.env.AUTH_DATA_DIR || "data", "auth.db");
  const db = new DatabaseSync(dbPath);
  try {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = db.prepare("SELECT answer FROM captcha_challenges WHERE token_hash = ?")
      .get(tokenHash);
    if (!row?.answer) throw new Error("captcha challenge row not found");
    const answer = JSON.parse(row.answer);
    const target = answer.target || [];
    const occluders = answer.occluders || [];
    const xs = target.map((point) => point.x);
    const ys = target.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (let ix = 1; ix < 30; ix += 1) {
      for (let iy = 1; iy < 30; iy += 1) {
        const x = minX + ((maxX - minX) * ix) / 30;
        const y = minY + ((maxY - minY) * iy) / 30;
        if (!pointInPolygon(x, y, target)) continue;
        if (occluders.some((polygon) => pointInPolygon(x, y, polygon))) continue;
        return `${Math.round(x)},${Math.round(y)}`;
      }
    }
    throw new Error("no visible point found for captcha");
  } finally {
    db.close();
  }
}
