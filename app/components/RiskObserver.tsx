"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

function webglInfo(): { vendor: string; renderer: string } {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl || !(gl instanceof WebGLRenderingContext)) return { vendor: "", renderer: "" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return { vendor: "", renderer: "" };
    return {
      vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || ""),
      renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || ""),
    };
  } catch {
    return { vendor: "", renderer: "" };
  }
}

function automationArtifacts(): boolean {
  try {
    const scope = window as unknown as Record<string, unknown>;
    const markers = [
      "__playwright", "__puppeteer", "__webdriver_evaluate", "__selenium_evaluate",
      "__fxdriver_evaluate", "__driver_evaluate", "_phantom", "callPhantom",
      "domAutomation", "__webdriver_script_func",
    ];
    if (markers.some((key) => key in scope)) return true;
    return Object.keys(scope).some((key) => key.startsWith("cdc_")
      || key.startsWith("__webdriver") || key.startsWith("__pw"));
  } catch {
    return false;
  }
}

function collectSignals() {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    pdfViewerEnabled?: boolean;
    maxTouchPoints?: number;
    userAgentData?: { mobile?: boolean; platform?: string };
  };
  const gl = webglInfo();
  const ua = navigator.userAgent;
  return {
    webdriver: navigator.webdriver === true,
    headless: /headlesschrome|phantomjs|puppeteer|playwright|selenium/i.test(ua),
    cdp: automationArtifacts(),
    platform: navigator.platform || "",
    languages: Array.from(navigator.languages || []),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screen: {
      width: window.screen?.width || 0,
      height: window.screen?.height || 0,
      colorDepth: window.screen?.colorDepth || 0,
    },
    screenAvail: {
      width: window.screen?.availWidth || 0,
      height: window.screen?.availHeight || 0,
    },
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemory: nav.deviceMemory || 0,
    plugins: navigator.plugins?.length || 0,
    mimeTypes: navigator.mimeTypes?.length || 0,
    pdfViewerEnabled: typeof nav.pdfViewerEnabled === "boolean" ? nav.pdfViewerEnabled : undefined,
    maxTouchPoints: nav.maxTouchPoints || 0,
    webglVendor: gl.vendor,
    webglRenderer: gl.renderer,
    outerWidth: window.outerWidth || 0,
    outerHeight: window.outerHeight || 0,
    chrome: Boolean((window as Window & { chrome?: unknown }).chrome),
    userAgentData: nav.userAgentData
      ? { mobile: nav.userAgentData.mobile, platform: nav.userAgentData.platform }
      : undefined,
  };
}

export function RiskObserver() {
  const pathname = usePathname();
  const lastPath = useRef("");

  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    lastPath.current = pathname;
    const timer = window.setTimeout(() => {
      fetch("/api/risk/observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname, signals: collectSignals() }),
        keepalive: true,
      }).catch(() => {
        // 观测失败不影响页面
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return null;
}
