export interface ClientSignals {
  webdriver?: boolean;
  headless?: boolean;
  platform?: string;
  languages?: string[];
  timezone?: string;
  screen?: { width?: number; height?: number; colorDepth?: number };
  hardwareConcurrency?: number;
  deviceMemory?: number;
  plugins?: number;
  mimeTypes?: number;
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

export function evaluateSignals(
  signals: ClientSignals,
  userAgent: string,
  tlsFingerprint: string | null,
): SignalEvaluation {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  const ua = `${userAgent} ${signals.webglRenderer || ""}`.toLowerCase();
  if (signals.webdriver === true) add(45, "navigator.webdriver=true");
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
  if (signals.outerWidth === 0 || signals.outerHeight === 0) add(12, "窗口外尺寸为 0");
  if (signals.chrome === false && /chrome/i.test(userAgent) && !/edg|opr/i.test(userAgent)) {
    add(6, "Chrome UA 但 window.chrome 缺失");
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
