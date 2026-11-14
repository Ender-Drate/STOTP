import { randomInt } from "node:crypto";
import sharp from "sharp";
import { getDb, nowSec } from "./db";
import { randomToken, sha256 } from "./crypto";

// 3D scene CAPTCHA inspired by the MIT-licensed sswahn/captcha and
// Moroura/shape-captcha-lib projects; see THIRD_PARTY_NOTICES.md.
const TTL = 3 * 60;
const MAX_ATTEMPTS = 5;
const WIDTH = 420;
const HEIGHT = 300;
const UNIT = 80;
const MAX_POLYGON_POINTS = 64;

export const CAPTCHA_COOKIE = "ac_captcha";
export type CaptchaLang = "zh" | "en";

export const CAPTCHA_PURPOSES = [
  "login", "register", "forgot-password", "reset-password",
] as const;

export type CaptchaPurpose = (typeof CAPTCHA_PURPOSES)[number];

export function isCaptchaPurpose(value: string): value is CaptchaPurpose {
  return (CAPTCHA_PURPOSES as readonly string[]).includes(value);
}

type Shape3D = "cube" | "cylinder" | "sphere";
type SizeClass = "small" | "normal" | "large";

interface Point { x: number; y: number }

interface ColorSpec {
  name: string;
  hex: string;
  line: string;
}

interface SceneObject {
  id: number;
  shape: Shape3D;
  color: ColorSpec;
  x: number;
  y: number;
  scale: number;
  depth: number;
}

interface Geometry {
  polygon: Point[];
  draw: string;
  shadow: { x: number; y: number; rx: number; ry: number };
}

interface CaptchaAnswer {
  target: Point[];
  occluders: Point[][];
}

const COLORS: ColorSpec[] = [
  { name: "白色", hex: "#f3f4f6", line: "#9ca3af" },
  { name: "黄色", hex: "#f2c94c", line: "#b7791f" },
  { name: "红色", hex: "#e5484d", line: "#991b1b" },
  { name: "蓝色", hex: "#3b82f6", line: "#1e40af" },
  { name: "绿色", hex: "#34a853", line: "#166534" },
  { name: "紫色", hex: "#8b5cf6", line: "#5b21b6" },
  { name: "橙色", hex: "#f08c00", line: "#9a3412" },
  { name: "青色", hex: "#14b8a6", line: "#115e59" },
];

const SHAPE_NAMES: Record<Shape3D, string> = {
  cube: "立方体",
  cylinder: "圆柱",
  sphere: "球体",
};
const SHAPE_NAMES_EN: Record<Shape3D, string> = {
  cube: "cube",
  cylinder: "cylinder",
  sphere: "sphere",
};
const COLOR_NAMES_EN: Record<string, string> = {
  "白色": "white", "黄色": "yellow", "红色": "red", "蓝色": "blue",
  "绿色": "green", "紫色": "purple", "橙色": "orange", "青色": "teal",
};

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(values: readonly T[]): T {
  return values[randomInt(0, values.length)];
}

function mix(hex: string, target: string, amount: number): string {
  const a = hex.replace("#", "");
  const b = target.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const av = parseInt(a.slice(offset, offset + 2), 16);
    const bv = parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(av + (bv - av) * amount).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

const lighten = (hex: string, amount = 0.25): string => mix(hex, "#ffffff", amount);
const darken = (hex: string, amount = 0.25): string => mix(hex, "#000000", amount);

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2
      && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2
      && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, count = 12): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

function objectGeometry(object: SceneObject): Geometry {
  if (object.shape === "sphere") {
    const radius = UNIT * 0.55 * object.scale;
    return {
      polygon: ellipsePoints(object.x, object.y, radius, radius, 18),
      draw: `<circle cx="${object.x.toFixed(1)}" cy="${object.y.toFixed(1)}" `
        + `r="${radius.toFixed(1)}" fill="url(#sphere-${object.id})" `
        + `stroke="${object.color.line}" stroke-width="1.5"/>`,
      shadow: { x: object.x, y: object.y + radius * 0.9, rx: radius * 1.05, ry: radius * 0.28 },
    };
  }

  if (object.shape === "cylinder") {
    const width = UNIT * 0.88 * object.scale;
    const height = UNIT * 0.95 * object.scale;
    const rx = width / 2;
    const ry = width * 0.19;
    const topY = object.y - height / 2;
    const bottomY = object.y + height / 2;
    const points = [
      ...ellipsePoints(object.x, topY, rx, ry, 14),
      ...ellipsePoints(object.x, bottomY, rx, ry, 14),
    ];
    const draw = `<g>
      <ellipse cx="${object.x.toFixed(1)}" cy="${bottomY.toFixed(1)}" `
        + `rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" `
        + `fill="${darken(object.color.hex, 0.28)}" `
        + `stroke="${object.color.line}" stroke-width="1.4"/>
      <rect x="${(object.x - rx).toFixed(1)}" y="${topY.toFixed(1)}" `
        + `width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${object.color.hex}"/>
      <rect x="${(object.x - rx).toFixed(1)}" y="${topY.toFixed(1)}" `
        + `width="${(width * 0.2).toFixed(1)}" height="${height.toFixed(1)}" `
        + `fill="${lighten(object.color.hex, 0.35)}" opacity="0.75"/>
      <rect x="${(object.x + rx - width * 0.22).toFixed(1)}" y="${topY.toFixed(1)}" `
        + `width="${(width * 0.22).toFixed(1)}" height="${height.toFixed(1)}" `
        + `fill="${darken(object.color.hex, 0.25)}" opacity="0.55"/>
      <ellipse cx="${object.x.toFixed(1)}" cy="${topY.toFixed(1)}" `
        + `rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" `
        + `fill="${lighten(object.color.hex, 0.2)}" `
        + `stroke="${object.color.line}" stroke-width="1.4"/>
    </g>`;
    return {
      polygon: convexHull(points),
      draw,
      shadow: { x: object.x, y: bottomY + ry * 0.8, rx: rx * 1.05, ry: ry * 0.5 },
    };
  }

  const width = UNIT * object.scale;
  const height = UNIT * object.scale;
  const dx = width * 0.3;
  const dy = -width * 0.24;
  const left = object.x - width / 2;
  const right = object.x + width / 2;
  const top = object.y - height / 2;
  const bottom = object.y + height / 2;
  const front = [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ];
  const topFace = [
    { x: left, y: top }, { x: left + dx, y: top + dy },
    { x: right + dx, y: top + dy }, { x: right, y: top },
  ];
  const sideFace = [
    { x: right, y: top }, { x: right + dx, y: top + dy },
    { x: right + dx, y: bottom + dy }, { x: right, y: bottom },
  ];
  const draw = `<g stroke="${object.color.line}" stroke-width="1.4" stroke-linejoin="round">
    <polygon points="${topFace.map((p) => `${p.x},${p.y}`).join(" ")}" fill="${lighten(object.color.hex, 0.22)}"/>
    <polygon points="${sideFace.map((p) => `${p.x},${p.y}`).join(" ")}" fill="${darken(object.color.hex, 0.24)}"/>
    <polygon points="${front.map((p) => `${p.x},${p.y}`).join(" ")}" fill="${object.color.hex}"/>
  </g>`;
  return {
    polygon: convexHull([...front, ...topFace, ...sideFace]),
    draw,
    shadow: { x: object.x, y: bottom + 4, rx: width * 0.55, ry: width * 0.14 },
  };
}

function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
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

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - a.x, y - a.y);
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

function distanceToPolygonEdges(x: number, y: number, polygon: Point[]): number {
  let best = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    best = Math.min(best, distanceToSegment(x, y, a, b));
  }
  return best;
}

function pointNearPolygon(x: number, y: number, polygon: Point[], tolerance: number): boolean {
  if (pointInPolygon(x, y, polygon)) return true;
  return distanceToPolygonEdges(x, y, polygon) <= tolerance;
}

function visiblePoint(target: Point[], occluders: Point[][]): { point: Point; area: number } | null {
  const xs = target.map((p) => p.x);
  const ys = target.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let best: { point: Point; clearance: number } | null = null;
  let area = 0;
  for (let ix = 1; ix < 20; ix += 1) {
    for (let iy = 1; iy < 20; iy += 1) {
      const point = {
        x: minX + ((maxX - minX) * ix) / 20,
        y: minY + ((maxY - minY) * iy) / 20,
      };
      if (!pointInPolygon(point.x, point.y, target)) continue;
      if (occluders.some((polygon) => pointInPolygon(point.x, point.y, polygon))) continue;
      area += 1;
      const clearance = distanceToPolygonEdges(point.x, point.y, target);
      if (!best || clearance > best.clearance) best = { point, clearance };
    }
  }
  if (!best || area < 24) return null;
  return { point: best.point, area };
}

function buildScene(lang: CaptchaLang): {
  objects: SceneObject[];
  target: Point[];
  occluders: Point[][];
  prompt: string;
  visible: Point;
} | null {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const targetColor = pick(COLORS);
    const targetShape = pick<Shape3D>(["cube", "cylinder", "sphere"]);
    const targetSize: "small" | "large" = Math.random() < 0.62 ? "small" : "large";
    const referenceColor = pick(COLORS.filter((color) => color !== targetColor));
    // The reference is a cube unless the target is a cube, in which case a
    // cylinder keeps the two silhouettes easy to distinguish.
    const referenceShape: Shape3D = targetShape === "cube" ? "cylinder" : "cube";
    const objects: SceneObject[] = [];

    const reference: SceneObject = {
      id: 1, shape: referenceShape, color: referenceColor,
      x: 190 + rand(-7, 7), y: 205 + rand(-4, 4),
      scale: 1, depth: 2,
    };
    const target: SceneObject = {
      id: 2, shape: targetShape, color: targetColor,
      x: reference.x + 58 + rand(-4, 4),
      y: reference.y - 52 + rand(-3, 3),
      scale: targetSize === "small" ? 0.68 : 0.9,
      depth: 6,
    };
    objects.push(reference, target);

    const spots: Array<[number, number, number]> = [
      [60, 126, 3], [348, 118, 4], [80, 238, 1], [342, 242, 2],
      [146, 86, 8], [312, 80, 7], [394, 192, 5],
    ];
    let nextId = 3;
    for (const [x, y, depth] of spots) {
      let shape = pick<Shape3D>(["cube", "cylinder", "sphere"]);
      let color = pick(COLORS);
      let size: SizeClass = pick<SizeClass>(["small", "normal", "large"]);
      let guard = 0;
      while (guard < 24 && shape === targetShape && color === targetColor
        && ((size === "small" && targetSize === "small")
          || (size === "large" && targetSize === "large"))) {
        shape = pick<Shape3D>(["cube", "cylinder", "sphere"]);
        color = pick(COLORS);
        size = pick<SizeClass>(["small", "normal", "large"]);
        guard += 1;
      }
      if (shape === referenceShape && color === referenceColor) {
        color = pick(COLORS.filter((item) => item !== referenceColor));
      }
      objects.push({
        id: nextId, shape, color,
        x: x + rand(-7, 7), y: y + rand(-5, 5),
        scale: size === "small" ? rand(0.52, 0.62)
          : size === "large" ? rand(0.8, 0.92) : rand(0.66, 0.78),
        depth,
      });
      nextId += 1;
    }

    const geometries = new Map(objects.map((object) => [object.id, objectGeometry(object)]));
    const targetPolygon = geometries.get(target.id)?.polygon;
    if (!targetPolygon) continue;
    const occluders = objects
      .filter((object) => object.depth < target.depth)
      .map((object) => geometries.get(object.id)?.polygon)
      .filter((polygon): polygon is Point[] => Boolean(polygon));
    const visible = visiblePoint(targetPolygon, occluders);
    if (!visible) continue;

    const sizeWord = targetSize === "small" ? "小型" : "大型";
    const prompt = lang === "en"
      ? `Click the ${targetSize} ${COLOR_NAMES_EN[targetColor.name] || targetColor.name} `
        + `${SHAPE_NAMES_EN[targetShape]} behind the `
        + `${COLOR_NAMES_EN[referenceColor.name] || referenceColor.name} ${SHAPE_NAMES_EN[referenceShape]}`
      : `点击画面中位于${referenceColor.name}${SHAPE_NAMES[referenceShape]}后面的`
        + `${sizeWord}${targetColor.name}${SHAPE_NAMES[targetShape]}`;
    return { objects, target: targetPolygon, occluders, prompt, visible: visible.point };
  }
  return null;
}

function sceneSvg(objects: SceneObject[]): string {
  const geometries = new Map(objects.map((object) => [object.id, objectGeometry(object)]));
  const ordered = [...objects].sort((a, b) => b.depth - a.depth);
  const shadows = ordered.map((object) => {
    const geometry = geometries.get(object.id);
    if (!geometry) return "";
    return `<ellipse cx="${geometry.shadow.x.toFixed(1)}" cy="${geometry.shadow.y.toFixed(1)}" `
      + `rx="${geometry.shadow.rx.toFixed(1)}" ry="${geometry.shadow.ry.toFixed(1)}" `
      + `fill="rgba(15,23,42,0.14)"/>`;
  }).join("");
  const draws = ordered.map((object) => geometries.get(object.id)?.draw || "").join("");
  const spheres = objects.filter((object) => object.shape === "sphere").map((object) => `
    <radialGradient id="sphere-${object.id}" cx="35%" cy="30%" r="70%">
      <stop offset="0" stop-color="${lighten(object.color.hex, 0.5)}"/>
      <stop offset="0.7" stop-color="${object.color.hex}"/>
      <stop offset="1" stop-color="${darken(object.color.hex, 0.28)}"/>
    </radialGradient>`).join("");
  const grid = Array.from({ length: 9 }, (_, index) => {
    const y = 110 + index * index * 3.2;
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${WIDTH}" y2="${y.toFixed(1)}" `
      + `stroke="rgba(15,23,42,0.07)" stroke-width="1"/>`;
  }).join("") + Array.from({ length: 11 }, (_, index) => {
    const bottomX = -80 + index * 58;
    return `<line x1="210" y1="110" x2="${bottomX}" y2="${HEIGHT}" `
      + `stroke="rgba(15,23,42,0.06)" stroke-width="1"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" `
    + `viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4f7fb"/><stop offset="1" stop-color="#e7edf5"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eef2f8"/><stop offset="1" stop-color="#dde5ef"/>
    </linearGradient>
    ${spheres}
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
  <rect y="110" width="${WIDTH}" height="${HEIGHT - 110}" fill="url(#floor)"/>
  ${grid}
  ${shadows}
  ${draws}
</svg>`;
}

function parseAnswer(value: string): CaptchaAnswer | null {
  try {
    const parsed = JSON.parse(value) as Partial<CaptchaAnswer>;
    if (!parsed || !Array.isArray(parsed.target) || !Array.isArray(parsed.occluders)) return null;
    const readPolygon = (candidate: unknown): Point[] | null => {
      if (!Array.isArray(candidate)) return null;
      if (candidate.length < 3 || candidate.length > MAX_POLYGON_POINTS) return null;
      const points: Point[] = [];
      for (const item of candidate) {
        if (!item || typeof item !== "object") return null;
        const point = item as { x?: unknown; y?: unknown };
        if (typeof point.x !== "number" || typeof point.y !== "number") return null;
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        points.push({ x: point.x, y: point.y });
      }
      return points;
    };
    const target = readPolygon(parsed.target);
    if (!target) return null;
    const occluders: Point[][] = [];
    for (const candidate of parsed.occluders) {
      const polygon = readPolygon(candidate);
      if (!polygon) return null;
      occluders.push(polygon);
      if (occluders.length > 16) return null;
    }
    return { target, occluders };
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

function pointHitsAnswer(answer: CaptchaAnswer, point: Point): boolean {
  if (!pointNearPolygon(point.x, point.y, answer.target, 2.5)) return false;
  return !answer.occluders.some((polygon) => pointInPolygon(point.x, point.y, polygon));
}

export async function generateCaptcha(
  ip: string,
  purpose: CaptchaPurpose,
  lang: CaptchaLang,
): Promise<{ token: string; image: string; prompt: string }> {
  const scene = buildScene(lang);
  if (!scene) throw new Error("captcha scene generation failed");
  const answer: CaptchaAnswer = { target: scene.target, occluders: scene.occluders };
  const serialized = JSON.stringify(answer);
  const token = randomToken(24);
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO captcha_challenges(
       token_hash, code_hash, answer, ip, purpose, attempts, expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(sha256(token), sha256(serialized), serialized, ip, purpose, now + TTL, now);
  getDb().prepare("DELETE FROM captcha_challenges WHERE expires_at < ?").run(now - 60);

  const png = await sharp(Buffer.from(sceneSvg(scene.objects))).png().toBuffer();
  return {
    token,
    image: `data:image/png;base64,${png.toString("base64")}`,
    prompt: scene.prompt,
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
  if (answer && point && pointHitsAnswer(answer, point)) {
    const result = getDb().prepare(
      "UPDATE captcha_challenges SET used = 1 WHERE token_hash = ? AND used = 0"
    ).run(tokenHash);
    return Number(result.changes) > 0;
  }

  getDb().prepare(
    `UPDATE captcha_challenges
     SET attempts = attempts + 1,
         used = CASE WHEN attempts + 1 >= ? THEN 1 ELSE used END
     WHERE token_hash = ? AND used = 0`
  ).run(MAX_ATTEMPTS, tokenHash);
  return false;
}

export {
  MAX_ATTEMPTS, TTL as CAPTCHA_TTL, WIDTH as CAPTCHA_WIDTH, HEIGHT as CAPTCHA_HEIGHT,
};
