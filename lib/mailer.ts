import nodemailer, { type Transporter } from "nodemailer";
import { PUBLIC_URL } from "./config";
import { decryptSetting, encryptSetting, getSetting, setSetting } from "./settings-store";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

let transporter: Transporter | null = null;

function envConfig(): SmtpConfig {
  return {
    host: process.env.AUTH_SMTP_HOST || "smtp.qiye.aliyun.com",
    port: Number(process.env.AUTH_SMTP_PORT || 465),
    secure: process.env.AUTH_SMTP_SECURE !== "0",
    user: process.env.AUTH_SMTP_USER || "noreply@yxzhou.com",
    pass: process.env.AUTH_SMTP_PASS || "",
    from: process.env.AUTH_MAIL_FROM || "STOTP <noreply@yxzhou.com>",
  };
}

function storedConfig(): SmtpConfig | null {
  const raw = getSetting("smtp");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      host?: string; port?: number; secure?: boolean; user?: string;
      passEnc?: string; from?: string;
    };
    const pass = parsed.passEnc ? decryptSetting(parsed.passEnc) : "";
    return {
      host: parsed.host || "",
      port: Number(parsed.port || 465),
      secure: parsed.secure !== false,
      user: parsed.user || "",
      pass,
      from: parsed.from || "STOTP <noreply@yxzhou.com>",
    };
  } catch {
    return null;
  }
}

function config(): SmtpConfig {
  return storedConfig() || envConfig();
}

export function mailConfigured(): boolean {
  const c = config();
  return Boolean(c.host && c.port && c.user && c.pass && c.from);
}

export function smtpView() {
  const c = config();
  return {
    host: c.host,
    port: c.port,
    secure: c.secure,
    user: c.user,
    from: c.from,
    hasPassword: Boolean(c.pass),
    source: getSetting("smtp") ? "database" : "environment",
  };
}

export function saveSmtpConfig(input: {
  host: string; port: number; secure: boolean; user: string; from: string;
  password?: string;
}): void {
  const existing = storedConfig() || envConfig();
  const pass = input.password ? input.password : existing.pass;
  if (!pass) throw new Error("SMTP 密码不能为空");
  setSetting("smtp", JSON.stringify({
    host: input.host,
    port: input.port,
    secure: input.secure,
    user: input.user,
    passEnc: encryptSetting(pass),
    from: input.from,
  }));
  transporter = null;
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const c = config();
  if (!c.pass) throw new Error("SMTP 未配置");
  transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function sendTestEmail(to: string): Promise<string> {
  const c = config();
  const info = await getTransporter().sendMail({
    from: c.from,
    to,
    subject: "STOTP SMTP 测试",
    text: "这是一封 STOTP Auth Center 的 SMTP 测试邮件。",
    html: "<p>这是一封 STOTP Auth Center 的 SMTP 测试邮件。</p>",
  });
  return info.messageId;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${PUBLIC_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const c = config();
  const text = [
    "欢迎注册 STOTP 账户。",
    "",
    "请打开下面的链接完成邮箱验证，链接 24 小时内有效：",
    link,
    "",
    "如果这不是你的操作，请忽略这封邮件。",
  ].join("\n");
  const safeLink = link.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await getTransporter().sendMail({
    from: c.from,
    to,
    subject: "验证你的 STOTP 账户邮箱",
    text,
    html: `<p>欢迎注册 STOTP 账户。</p>
<p>请打开下面的链接完成邮箱验证，链接 24 小时内有效：</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>如果这不是你的操作，请忽略这封邮件。</p>`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  riskLevel: string,
): Promise<void> {
  const link = `${PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const c = config();
  const text = [
    "我们收到了重置 STOTP 账户密码的请求。",
    "",
    "请在 30 分钟内打开下面的链接设置新密码：",
    link,
    "",
    `本次请求风险等级：${riskLevel}`,
    "如果这不是你的操作，请忽略这封邮件，并尽快检查账号安全。",
  ].join("\n");
  const safeLink = link.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await getTransporter().sendMail({
    from: c.from,
    to,
    subject: "重置你的 STOTP 账户密码",
    text,
    html: `<p>我们收到了重置 STOTP 账户密码的请求。</p>
<p>请在 30 分钟内打开下面的链接设置新密码：</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>本次请求风险等级：<strong>${riskLevel}</strong></p>
<p>如果这不是你的操作，请忽略这封邮件，并尽快检查账号安全。</p>`,
  });
}

export async function sendEmailChangedEmail(
  to: string,
  newEmail: string,
  when: string,
): Promise<void> {
  const c = config();
  const safeNew = newEmail.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const text = [
    "你的 STOTP 账户邮箱刚刚被修改。",
    "",
    `新邮箱：${newEmail}`,
    `时间：${when}`,
    "",
    "如果这是你的操作，请同时检查新邮箱的验证邮件。",
    "如果不是你的操作，请立即使用「忘记密码」重置密码，并联系管理员。",
  ].join("\n");
  await getTransporter().sendMail({
    from: c.from,
    to,
    subject: "你的 STOTP 账户邮箱已修改",
    text,
    html: `<p>你的 STOTP 账户邮箱刚刚被修改。</p>
<p>新邮箱：<strong>${safeNew}</strong><br/>时间：${when}</p>
<p>如果这是你的操作，请同时检查新邮箱的验证邮件。</p>
<p><strong>如果不是你的操作，请立即使用「忘记密码」重置密码，并联系管理员。</strong></p>`,
  });
}
