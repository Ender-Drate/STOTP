import type { NextConfig } from "next";

const publicUrl = process.env.AUTH_PUBLIC_URL || "http://localhost:3100";
const localHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl);
if (process.env.NODE_ENV === "production" && process.env.AUTH_E2E === "1" && !localHttp) {
  throw new Error("AUTH_E2E=1 只能用于本地测试，生产环境拒绝启动");
}

const dev = process.env.NODE_ENV !== "production";
const scriptSrc = `'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`;
const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["ip2region"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/openid-configuration",
        destination: "/api/oauth/discovery",
      },
      {
        source: "/api/oauth/.well-known/openid-configuration",
        destination: "/api/oauth/discovery",
      },
    ];
  },
};

export default nextConfig;
