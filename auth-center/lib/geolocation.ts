import { IP2Region } from "ip2region/node";
import { isPrivateIp, normalizeIp } from "./ip";

let searcher: IP2Region | null = null;
const cache = new Map<string, string>();

function getSearcher(): IP2Region | null {
  if (searcher) return searcher;
  try {
    searcher = new IP2Region({ families: [4], mappedIPv6: "ipv4" });
    return searcher;
  } catch (error) {
    console.error("[geolocation] ip2region unavailable", error);
    return null;
  }
}

export function lookupIpLocation(ip: string): string {
  const normalized = normalizeIp(ip) || ip;
  if (!normalized) return "未知";
  if (normalized === "127.0.0.1" || normalized === "::1") return "本机";
  if (isPrivateIp(normalized)) return "内网";
  const cached = cache.get(normalized);
  if (cached) return cached;
  const instance = getSearcher();
  if (!instance) return "未知";
  try {
    const result = instance.lookup(normalized) as {
      country?: { name?: string };
      subdivisions?: Array<{ name?: string }>;
      city?: { name?: string };
      isp?: string;
    } | null;
    if (!result) return "未知";
    const country = result.country?.name || "";
    const region = result.subdivisions?.[0]?.name || "";
    const city = result.city?.name || "";
    let location = country === "中国"
      ? `${region}${city}`
      : [country, region, city].filter(Boolean).join(" ");
    if (!location) location = "未知";
    if (cache.size > 5000) cache.clear();
    cache.set(normalized, location);
    return location;
  } catch {
    return "未知";
  }
}
