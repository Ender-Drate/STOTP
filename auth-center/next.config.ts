import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ip2region"],
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
