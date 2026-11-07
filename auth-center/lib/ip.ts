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
  if (ip === "::1" || ip.startsWith("127.")) return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  return false;
}

export function firstPublicIp(values: Array<string | null | undefined>): string {
  const ips = values.map(normalizeIp).filter(Boolean);
  return ips.find((ip) => !isPrivateIp(ip)) || ips[0] || "127.0.0.1";
}
