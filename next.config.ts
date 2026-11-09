import type { NextConfig } from "next";

const publicUrl = process.env.AUTH_PUBLIC_URL || "http://localhost:3100";
const localHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl);
if (process.env.NODE_ENV === "production" && process.env.AUTH_E2E === "1" && !localHttp) {
  throw new Error("AUTH_E2E=1 只能用于本地测试，生产环境拒绝启动");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["ip2region"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(publicUrl.startsWith("https://") ? [{
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          }] : []),
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/oauth/.well-known/openid-configuration",
        destination: "/api/oauth/discovery",
      },
    ];
  },
};

export default nextConfig;
