import { randomInt } from "node:crypto";
import sharp from "sharp";
import { getDb, nowSec } from "./db";
import { randomToken, sha256 } from "./crypto";

// Shape-click CAPTCHA adapted from the MIT-licensed sswahn/captcha and
// Moroura/shape-captcha-lib projects; see THIRD_PARTY_NOTICES.md.

const TTL = 3 * 60;
const MAX_ATTEMPTS = 5;
const WIDTH = 360;
const HEIGHT = 240;
const COLS = 3;
const ROWS = 3;
const CELL_WIDTH = WIDTH / COLS;
const CELL_HEIGHT = HEIGHT / ROWS;

export const CAPTCHA_PURPOSES = [
  "login", "register", "forgot-password", "reset-password",
] as const;

export type CaptchaPurpose = (typeof CAPTCHA_PURPOSES)[number];

export function isCaptchaPurpose(value: string): value is CaptchaPurpose {
  return (CAPTCHA_PURPOSES as readonly string[]).includes(value);
}

const SHAPE_TYPES = [
  "circle", "triangle", "square", "pentagon", "hexagon", "star", "cross", "diamond",
] as const;

type ShapeType = (typeof SHAPE_TYPES)[number];

const SHAPE_NAMES: Record<ShapeType, string> = {
  circle: "圆形",
  triangle: "三角形",
  square: "正方形",
  pentagon: "五边形",
  hexagon: "六边形",
  star: "五角星",
  cross: "十字",
  diamond: "菱形",
};

const PALETTE = [
  "#e5484d", "#0b6bcb", "#2f9e44", "#f08c00",
  "#7048e8", "#c2255c", "#0c8599", "#7a4b2a",
];

const BACKGROUNDS = [
  ["#f8fafc", "#eef2f7"],
  ["#faf8f5", "#f1ece5"],
  ["#f4f9f6", "#e7f1ec"],
  ["#f7f5fc", "#ece8f7"],
];

interface Point { x: number; y: number }

interface PlacedShape {
  type: ShapeType;
  cx: number;
  cy: number;
  size: number;
  rotation: number;
  color: string;
}

interface CaptchaAnswer {
  type: ShapeType;
  cx: number;
  cy: number;
  size: number;
  rotation: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickIndex(length: number): number {
  return randomInt(0, length);
}

function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = pickIndex(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function regularPolygon(sides: number, radius: number, rotation: number): Point[] {
  const start = -Math.PI / 2 + (rotation * Math.PI) / 180;
  return Array.from({ length: sides }, (_, index) => {
    const angle = start + (index * 2 * Math.PI) / sides;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function starPolygon(radius: number, rotation: number): Point[] {
  const start = -Math.PI / 2 + (rotation * Math.PI) / 180;
  return Array.from({ length: 10 }, (_, index) => {
    const current = index % 2 === 0 ? radius : radius * 0.45;
    const angle = start + (index * Math.PI) / 5;
    return { x: Math.cos(angle) * current, y: Math.sin(angle) * current };
  });
}

function crossPolygon(size: number): Point[] {
  const arm = size * 0.38;
  return [
    { x: -arm, y: -size }, { x: arm, y: -size }, { x: arm, y: -arm },
    { x: size, y: -arm }, { x: size, y: arm }, { x: arm, y: arm },
    { x: arm, y: size }, { x: -arm, y: size }, { x: -arm, y: arm },
    { x: -size, y: arm }, { x: -size, y: -arm }, { x: -arm, y: -arm },
  ];
}

function shapePoints(type: ShapeType, size: number, rotation: number): Point[] {
  switch (type) {
    case "triangle": return regularPolygon(3, size, rotation);
    // A regular 4-gon with 45° offset is axis-aligned; 0° renders as a diamond.
    case "square": return regularPolygon(4, size, 45);
    case "diamond": return regularPolygon(4, size, 0);
    case "pentagon": return regularPolygon(5, size, rotation);
    case "hexagon": return regularPolygon(6, size, rotation);
    case "star": return starPolygon(size, rotation);
    case "cross": return crossPolygon(size);
    default: return [];
  }
}

function shapeMarkup(shape: PlacedShape): string {
  const stroke = `fill="${shape.color}" stroke="#1f2937" stroke-width="2" opacity="0.94"`;
  if (shape.type === "circle") {
    return `<circle cx="${shape.cx.toFixed(1)}" cy="${shape.cy.toFixed(1)}" `
      + `r="${shape.size.toFixed(1)}" ${stroke}/>`;
  }
  const points = shapePoints(shape.type, shape.size, shape.rotation)
    .map((point) => `${(shape.cx + point.x).toFixed(1)},${(shape.cy + point.y).toFixed(1)}`)
    .join(" ");
  return `<polygon points="${points}" ${stroke} stroke-linejoin="round"/>`;
}

function shapeCaptchaSvg(shapes: PlacedShape[]): string {
  const [bgFrom, bgTo] = BACKGROUNDS[pickIndex(BACKGROUNDS.length)];
  const grid = Array.from({ length: 7 }, (_, index) => {
    const y = (index + 1) * 30;
    return `<line x1="0" y1="${y}" x2="${WIDTH}" y2="${y}" stroke="rgba(15,23,42,0.035)" stroke-width="1"/>`;
  }).join("") + Array.from({ length: 11 }, (_, index) => {
    const x = (index + 1) * 30;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${HEIGHT}" stroke="rgba(15,23,42,0.03)" stroke-width="1"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" `
    + `viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bgFrom}"/>
      <stop offset="1" stop-color="${bgTo}"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <g opacity="0.7">${grid}</g>
  ${shapes.map(shapeMarkup).join("")}
</svg>`;
}

function pointInPolygon(x: number, y: number, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if ((a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - a.x, y - a.y);
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

function pointHitsAnswer(answer: CaptchaAnswer, x: number, y: number): boolean {
  if (answer.type === "circle") {
    return Math.hypot(x - answer.cx, y - answer.cy) <= answer.size + 2.5;
  }
  const points = shapePoints(answer.type, answer.size, answer.rotation)
    .map((point) => ({ x: answer.cx + point.x, y: answer.cy + point.y }));
  if (pointInPolygon(x, y, points)) return true;
  return points.some((point, index) => {
    const next = points[(index + 1) % points.length];
    return distanceToSegment(x, y, point, next) <= 2.5;
  });
}

function parseAnswer(value: string): CaptchaAnswer | null {
  try {
    const parsed = JSON.parse(value) as Partial<CaptchaAnswer>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!SHAPE_TYPES.includes(parsed.type as ShapeType)) return null;
    const numbers = [parsed.cx, parsed.cy, parsed.size, parsed.rotation];
    if (!numbers.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
    return parsed as CaptchaAnswer;
  } catch {
    return null;
  }
}

function parsePoint(code: string): Point | null {
  const parts = code.trim().split(",");
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x > WIDTH || y > HEIGHT) return null;
  return { x, y };
}

function buildShapes(): { shapes: PlacedShape[]; target: PlacedShape } {
  const types = shuffle(SHAPE_TYPES).slice(0, 8);
  const cells = shuffle(Array.from({ length: COLS * ROWS }, (_, index) => index)).slice(0, 8);
  const colors = shuffle(PALETTE).slice(0, 8);
  const shapes = types.map((type, index) => {
    const cell = cells[index];
    const col = cell % COLS;
    const row = Math.floor(cell / COLS);
    return {
      type,
      cx: col * CELL_WIDTH + CELL_WIDTH / 2 + rand(-7, 7),
      cy: row * CELL_HEIGHT + CELL_HEIGHT / 2 + rand(-5, 5),
      size: rand(24, 33),
      rotation: ["square", "diamond", "cross"].includes(type) ? 0 : rand(0, 360),
      color: colors[index],
    };
  });
  return { shapes, target: shapes[pickIndex(shapes.length)] };
}

export async function generateCaptcha(ip: string, purpose: CaptchaPurpose): Promise<{
  ticket: string; image: string; prompt: string; testAnswer?: string;
}> {
  const { shapes, target } = buildShapes();
  const answer: CaptchaAnswer = {
    type: target.type, cx: target.cx, cy: target.cy,
    size: target.size, rotation: target.rotation,
  };
  const serialized = JSON.stringify(answer);
  const ticket = randomToken(24);
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO captcha_challenges(
       token_hash, code_hash, answer, ip, purpose, attempts, expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(sha256(ticket), sha256(serialized), serialized, ip, purpose, now + TTL, now);
  getDb().prepare("DELETE FROM captcha_challenges WHERE expires_at < ?").run(now - 60);

  const png = await sharp(Buffer.from(shapeCaptchaSvg(shapes))).png().toBuffer();
  const prompt = `点击图中的${SHAPE_NAMES[target.type]}`;
  return {
    ticket,
    image: `data:image/png;base64,${png.toString("base64")}`,
    prompt,
    ...(process.env.AUTH_E2E === "1"
      ? { testAnswer: `${Math.round(target.cx)},${Math.round(target.cy)}` }
      : {}),
  };
}

export function verifyCaptcha(
  ticket: string,
  code: string,
  ip: string,
  purpose: CaptchaPurpose,
): boolean {
  if (!ticket || !code) return false;
  const tokenHash = sha256(ticket);
  const row = getDb().prepare("SELECT * FROM captcha_challenges WHERE token_hash = ?")
    .get(tokenHash) as unknown as {
    answer: string; ip: string; purpose: string; attempts: number;
    expires_at: number; used: number;
  } | undefined;
  if (!row || row.used || row.expires_at < nowSec() || row.ip !== ip) return false;
  if (row.purpose !== purpose) return false;

  const answer = parseAnswer(row.answer);
  const point = parsePoint(code);
  if (answer && point && pointHitsAnswer(answer, point.x, point.y)) {
    const result = getDb().prepare(
      "UPDATE captcha_challenges SET used = 1 WHERE token_hash = ? AND used = 0"
    ).run(tokenHash);
    return Number(result.changes) > 0;
  }

  // A wrong click (or malformed coordinate) consumes an attempt; after
  // MAX_ATTEMPTS the ticket is burnt.
  getDb().prepare(
    `UPDATE captcha_challenges
     SET attempts = attempts + 1,
         used = CASE WHEN attempts + 1 >= ? THEN 1 ELSE used END
     WHERE token_hash = ? AND used = 0`
  ).run(MAX_ATTEMPTS, tokenHash);
  return false;
}

export {
  shapeCaptchaSvg, shapePoints, MAX_ATTEMPTS, WIDTH as CAPTCHA_WIDTH, HEIGHT as CAPTCHA_HEIGHT,
};
