/** IP 规范化与私网判断，供请求日志、风控和审计复用。 */
import { isIP } from "node:net";

export function normalizeIp(raw: string | null | undefined): string {
  if (!raw) return "";
  let value = raw.trim().replace(/^"|"$/g, "");
  if (/^for=/i.test(value)) value = value.slice(4).trim();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end > 0) value = value.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.split(":")[0];
  }
  if (/^::ffff:/i.test(value)) value = value.slice(7);
  if (!value || value.toLowerCase() === "unknown" || value === "-") return "";
  return isIP(value) ? value : "";
}

export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  const value = normalizeIp(ip) || ip.toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51) return true;
    if (a === 203 && b === 0) return true;
    if (a >= 224) return true;
    return false;
  }
  if (isIP(value) === 6) {
    if (value === "::1" || value === "::") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(value)) return true;
    if (value.startsWith("ff")) return true;
    if (value.startsWith("2001:db8")) return true;
    return false;
  }
  return true;
}

export function firstPublicIp(values: Array<string | null | undefined>): string {
  const ips = values.map(normalizeIp).filter(Boolean);
  return ips.find((ip) => !isPrivateIp(ip)) || ips[0] || "127.0.0.1";
}

/**
 * 从代理头中取第一个合法 IP。
 *
 * 兼容 `X-Real-IP: 112.9.40.76, 112.9.40.76` 这种被多层代理重复追加的值；
 * 只应传入 nginx 覆盖后的 X-Real-IP，不要传客户端可控的 XFF。
 */
export function firstValidIp(values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (!value) continue;
    for (const part of String(value).split(",")) {
      const ip = normalizeIp(part);
      if (ip) return ip;
    }
  }
  return "";
}
