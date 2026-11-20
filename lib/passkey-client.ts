export function passkeySupportError(): string {
  if (typeof window === "undefined") return "当前环境不支持 Passkey";
  if (!window.isSecureContext) return "Passkey 需要 HTTPS 域名（localhost 除外）";
  if (typeof window.PublicKeyCredential === "undefined") return "当前浏览器不支持 Passkey";
  return "";
}

export function passkeyErrorText(error: unknown): string {
  if (!(error instanceof Error)) return "Passkey 操作失败";
  if (error.name === "NotAllowedError") {
    return "已取消、超时，或该设备没有可用的 Passkey";
  }
  if (error.name === "SecurityError") {
    return "Passkey 域名校验失败，请确认 AUTH_PUBLIC_URL 与访问地址一致";
  }
  if (error.name === "NotSupportedError") {
    return "当前浏览器或设备不支持这个 Passkey";
  }
  if (error.name === "InvalidStateError") {
    return "该 Passkey 已在此设备注册";
  }
  return `Passkey 操作失败：${error.message}`;
}
