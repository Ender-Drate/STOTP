import type { Metadata } from "next";
import "./globals.css";
import "./liquid-glass.css";
import { RiskObserver } from "@/app/components/RiskObserver";

export const metadata: Metadata = {
  title: "STOTP 账户",
  description: "STOTP Auth Center · OIDC 统一登录",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <RiskObserver />
      </body>
    </html>
  );
}
