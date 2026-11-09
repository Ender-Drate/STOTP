import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./liquid-glass.css";
import { RiskObserver } from "@/app/components/RiskObserver";
import { PreferencesDock } from "@/app/components/PreferencesDock";
import { GlassHover } from "@/app/components/GlassHover";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") || "";
  const boot = `(function(){try{var p=localStorage.getItem("stotp-theme")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";var l=localStorage.getItem("stotp-lang");var n=l||((navigator.language||"zh").toLowerCase().indexOf("zh")===0?"zh":"en");document.documentElement.lang=n==="zh"?"zh-CN":"en";}catch(e){}})();`;
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body>
        {children}
        <RiskObserver />
        <PreferencesDock />
        <GlassHover />
      </body>
    </html>
  );
}
