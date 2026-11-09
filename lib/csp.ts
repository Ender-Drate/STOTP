import { getSetting, setSetting } from "./settings-store";

export interface CspDirective {
  name: string;
  sources: string[];
}

export const CSP_NONCE_TOKEN = "{{nonce}}";

export const DEFAULT_CSP: CspDirective[] = [
  { name: "default-src", sources: ["'self'"] },
  { name: "script-src", sources: ["'self'", `'nonce-${CSP_NONCE_TOKEN}'`] },
  { name: "style-src", sources: ["'self'", "'unsafe-inline'"] },
  {
    name: "img-src",
    sources: ["'self'", "data:", "https://auth.builddreams.cn", "https:"],
  },
  { name: "font-src", sources: ["'self'", "data:"] },
  { name: "connect-src", sources: ["'self'"] },
  { name: "object-src", sources: ["'none'"] },
  { name: "base-uri", sources: ["'none'"] },
  { name: "form-action", sources: ["'self'", "https:"] },
  { name: "frame-ancestors", sources: ["'none'"] },
];

const NAME_RE = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_DIRECTIVES = 40;
const MAX_SOURCES = 100;
const MAX_SOURCE_LENGTH = 500;

export function cloneDefaultCsp(): CspDirective[] {
  return DEFAULT_CSP.map((item) => ({ name: item.name, sources: [...item.sources] }));
}

export function sanitizeCsp(input: unknown): CspDirective[] {
  if (!Array.isArray(input)) throw new Error("CSP 配置必须是数组");
  const result: CspDirective[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_DIRECTIVES)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { name?: unknown; sources?: unknown };
    const name = String(item.name || "").trim().toLowerCase();
    if (!NAME_RE.test(name) || seen.has(name)) continue;
    seen.add(name);
    const values = Array.isArray(item.sources) ? item.sources : [];
    const sources: string[] = [];
    for (const value of values.slice(0, MAX_SOURCES)) {
      if (typeof value !== "string") continue;
      const source = value.trim();
      if (!source || source.length > MAX_SOURCE_LENGTH) continue;
      if (/[;\r\n]/.test(source)) continue;
      if (!sources.includes(source)) sources.push(source);
    }
    result.push({ name, sources });
  }
  if (!result.some((item) => item.name === "script-src")) {
    result.unshift({
      name: "script-src",
      sources: ["'self'", `'nonce-${CSP_NONCE_TOKEN}'`],
    });
  }
  return result;
}

export function readCspConfig(): CspDirective[] {
  try {
    const raw = getSetting("csp_config");
    if (!raw) return cloneDefaultCsp();
    return sanitizeCsp(JSON.parse(raw));
  } catch {
    return cloneDefaultCsp();
  }
}

export function saveCspConfig(input: unknown): CspDirective[] {
  const directives = sanitizeCsp(input);
  setSetting("csp_config", JSON.stringify(directives));
  return directives;
}

export function buildCsp(
  input: CspDirective[],
  nonce: string,
  dev = false,
): string {
  const directives = sanitizeCsp(input).map((item) => ({
    name: item.name,
    sources: [...item.sources],
  }));
  const script = directives.find((item) => item.name === "script-src")!;
  const nonceSource = `'nonce-${nonce}'`;
  script.sources = script.sources.map((source) =>
    source === `'nonce-${CSP_NONCE_TOKEN}'` ? nonceSource : source
  );
  if (!script.sources.includes(nonceSource)) script.sources.push(nonceSource);
  if (dev && !script.sources.includes("'unsafe-eval'")) script.sources.push("'unsafe-eval'");
  if (!script.sources.includes("'self'")) script.sources.unshift("'self'");

  const connect = directives.find((item) => item.name === "connect-src");
  if (dev && connect && !connect.sources.includes("ws:")) {
    connect.sources.push("ws:", "wss:");
  }
  return directives
    .map((item) => `${item.name} ${item.sources.join(" ")}`.trim())
    .join("; ");
}
