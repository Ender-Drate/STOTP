import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { getDb, nowSec } from "./db";
import { randomToken, safeEqual, sha256 } from "./crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TTL = 5 * 60;

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;",
  }[char] || char));
}

function randomCode(length = 5): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

function captchaSvg(code: string): string {
  const chars = code.split("").map((char, index) => {
    const x = 20 + index * 26 + Math.floor(Math.random() * 5);
    const y = 32 + Math.floor(Math.random() * 5);
    const rotate = -18 + Math.floor(Math.random() * 36);
    const color = ["#1d1d1f", "#0071e3", "#5e5ce6", "#1f6f43"][Math.floor(Math.random() * 4)];
    return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})"
      font-family="Georgia, 'Times New Roman', serif" font-size="25" font-weight="700"
      fill="${color}" opacity="0.92">${escapeXml(char)}</text>`;
  }).join("");

  const noise = Array.from({ length: 5 }, () => {
    const x1 = Math.floor(Math.random() * 160);
    const y1 = Math.floor(Math.random() * 52);
    const x2 = Math.floor(Math.random() * 160);
    const y2 = Math.floor(Math.random() * 52);
    const cx = Math.floor(Math.random() * 160);
    const cy = Math.floor(Math.random() * 52);
    return `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none"
      stroke="rgba(0,113,227,${(0.12 + Math.random() * 0.2).toFixed(2)})" stroke-width="${1 + Math.random() * 1.2}"/>`;
  }).join("");

  const dots = Array.from({ length: 36 }, () => {
    const x = Math.random() * 160;
    const y = Math.random() * 52;
    const r = Math.random() * 1.4 + 0.4;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"
      fill="rgba(29,29,31,${(0.15 + Math.random() * 0.25).toFixed(2)})"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="52" viewBox="0 0 160 52">
    <rect width="160" height="52" rx="9" fill="#f5f5f7"/>
    <path d="M0 36 Q40 18 80 34 T160 28" fill="none" stroke="rgba(0,113,227,0.16)" stroke-width="7"/>
    ${noise}${dots}${chars}
  </svg>`;
}

export async function generateCaptcha(ip: string): Promise<{
  ticket: string; image: string; testCode?: string;
}> {
  const code = randomCode();
  const ticket = randomToken(24);
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO captcha_challenges(token_hash, code_hash, ip, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sha256(ticket), sha256(code), ip, now + TTL, now);
  getDb().prepare("DELETE FROM captcha_challenges WHERE expires_at < ?").run(now - 60);
  const png = await sharp(Buffer.from(captchaSvg(code))).png().toBuffer();
  return {
    ticket,
    image: `data:image/png;base64,${png.toString("base64")}`,
    ...(process.env.AUTH_E2E === "1" ? { testCode: code } : {}),
  };
}

export function verifyCaptcha(ticket: string, code: string, ip: string): boolean {
  if (!ticket || !code) return false;
  const row = getDb().prepare("SELECT * FROM captcha_challenges WHERE token_hash = ?")
    .get(sha256(ticket)) as unknown as {
    code_hash: string; ip: string; expires_at: number; used: number;
  } | undefined;
  if (!row || row.used || row.expires_at < nowSec() || row.ip !== ip) return false;
  if (!safeEqual(row.code_hash, sha256(code.trim().toUpperCase()))) return false;
  const result = getDb().prepare(
    "UPDATE captcha_challenges SET used = 1 WHERE token_hash = ? AND used = 0"
  ).run(sha256(ticket));
  return Number(result.changes) > 0;
}

export { captchaSvg };
