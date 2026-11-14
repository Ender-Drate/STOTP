export interface ClientSignals {
  webdriver?: boolean;
  headless?: boolean;
  cdp?: boolean;
  platform?: string;
  languages?: string[];
  timezone?: string;
  screen?: { width?: number; height?: number; colorDepth?: number };
  screenAvail?: { width?: number; height?: number };
  hardwareConcurrency?: number;
  deviceMemory?: number;
  plugins?: number;
  mimeTypes?: number;
  pdfViewerEnabled?: boolean;
  maxTouchPoints?: number;
  webglVendor?: string;
  webglRenderer?: string;
  outerWidth?: number;
  outerHeight?: number;
  chrome?: boolean;
  userAgentData?: { mobile?: boolean; platform?: string };
}

export interface SignalEvaluation {
  score: number;
  reasons: string[];
}

function primaryLanguage(value: string): string {
  return value.trim().toLowerCase().split(/[-;,]/)[0] || "";
}

function platformFamily(value: string): string {
  const text = value.toLowerCase();
  if (/win/.test(text)) return "windows";
  if (/mac|iphone|ipad|ios/.test(text)) return "mac";
  if (/android/.test(text)) return "android";
  if (/linux|x11/.test(text)) return "linux";
  return "";
}

export function evaluateSignals(
  signals: ClientSignals,
  userAgent: string,
  tlsFingerprint: string | null,
  headers?: Headers,
): SignalEvaluation {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  const ua = `${userAgent} ${signals.webglRenderer || ""}`.toLowerCase();
  if (signals.webdriver === true) add(45, "navigator.webdriver=true");
  if (signals.cdp === true) add(45, "检测到 CDP/自动化残留");
  if (/(headlesschrome|phantomjs|puppeteer|playwright|selenium|electron)/i.test(ua)) {
    add(35, "User-Agent/WebGL 含自动化特征");
  }
  if (signals.headless === true) add(20, "客户端自报 headless");
  if ((signals.webglRenderer || "").toLowerCase().match(/swiftshader|llvmpipe|mesa offscreen/)) {
    add(25, "软件渲染 WebGL");
  }
  if (signals.plugins === 0) add(8, "浏览器插件列表为空");
  if (!signals.languages?.length) add(8, "未提供浏览器语言");
  if (!signals.timezone) add(6, "未提供时区");
  if (!signals.hardwareConcurrency || signals.hardwareConcurrency <= 1) {
    add(8, "CPU 并发数异常");
  }
  if (!signals.screen?.width || !signals.screen?.height) add(8, "屏幕尺寸缺失");
  if (!signals.screenAvail?.width || !signals.screenAvail?.height) {
    add(6, "屏幕可用尺寸缺失");
  }
  if (signals.outerWidth === 0 || signals.outerHeight === 0) add(12, "窗口外尺寸为 0");
  if (signals.chrome === false && /chrome/i.test(userAgent) && !/edg|opr/i.test(userAgent)) {
    add(6, "Chrome UA 但 window.chrome 缺失");
  }
  if (signals.pdfViewerEnabled === false && /chrome/i.test(userAgent)
    && !/edg|opr/i.test(userAgent)) {
    add(8, "PDF 查看器状态异常");
  }

  const mobileUa = /iphone|ipad|android|mobile/i.test(userAgent);
  if (mobileUa && signals.maxTouchPoints === 0) add(20, "移动 UA 但无触摸点");

  if (signals.userAgentData?.mobile === true && signals.maxTouchPoints === 0) {
    add(16, "客户端声明移动端但无触摸点");
  }

  const platformFromUaData = platformFamily(signals.userAgentData?.platform || "");
  const platformFromNavigator = platformFamily(signals.platform || "");
  if (platformFromUaData && platformFromNavigator
    && platformFromUaData !== platformFromNavigator) {
    add(16, "客户端平台声明不一致");
  }

  if (headers) {
    const acceptLanguage = headers.get("accept-language") || "";
    const languages = signals.languages || [];
    if (acceptLanguage && languages.length) {
      const headerLang = primaryLanguage(acceptLanguage.split(",")[0] || "");
      const hasMatch = languages.some((language) => primaryLanguage(language) === headerLang);
      if (headerLang && !hasMatch) add(18, "语言与请求头不一致");
    }
    const fetchSite = headers.get("sec-fetch-site");
    if (!fetchSite) add(6, "缺少 Sec-Fetch-Site");
    else if (fetchSite !== "same-origin") add(10, "Sec-Fetch-Site 异常");

    const chPlatform = (headers.get("sec-ch-ua-platform") || "").replace(/"/g, "").trim();
    const chFamily = platformFamily(chPlatform);
    if (chFamily && platformFromNavigator && chFamily !== platformFromNavigator) {
      add(14, "客户端平台与 Client Hints 不一致");
    }
  }

  if (tlsFingerprint && /^(0+|unknown)$/i.test(tlsFingerprint)) {
    add(4, "TLS 指纹异常");
  }

  return { score: Math.min(100, score), reasons };
}

export function readTlsFingerprint(headers: Headers): string | null {
  const keys = [
    "x-tls-fingerprint",
    "x-ja3-fingerprint",
    "x-ja4-fingerprint",
    "x-ja3-hash",
    "x-ssl-ja3",
  ];
  for (const key of keys) {
    const value = headers.get(key);
    if (value && value.trim()) return value.trim().slice(0, 200);
  }
  return null;
}
