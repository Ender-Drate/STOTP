import { HttpError } from "./http";

export function text(value: unknown, field: string, min: number, max: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length < min) throw new HttpError(400, "invalid_request", `${field} 至少 ${min} 个字符`);
  if (result.length > max) throw new HttpError(400, "invalid_request", `${field} 不能超过 ${max} 个字符`);
  return result;
}

export function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (!result) return null;
  if (result.length > max) throw new HttpError(400, "invalid_request", `内容不能超过 ${max} 个字符`);
  return result;
}

export function email(value: unknown): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) || result.length > 120) {
    throw new HttpError(400, "invalid_request", "邮箱格式不正确");
  }
  return result.toLowerCase();
}

export function username(value: unknown): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(result)) {
    throw new HttpError(400, "invalid_request", "用户名需为 3-32 位字母、数字、下划线或点");
  }
  return result;
}

export function password(value: unknown): string {
  const result = typeof value === "string" ? value : "";
  if (result.length < 8) throw new HttpError(400, "invalid_request", "密码至少 8 位");
  if (result.length > 128) throw new HttpError(400, "invalid_request", "密码过长");
  return result;
}

export function redirectUri(value: unknown): string {
  const result = typeof value === "string" ? value.trim() : "";
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new HttpError(400, "invalid_request", "回调地址不合法");
  }
  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) {
    throw new HttpError(400, "invalid_request", "回调地址必须是 https://（本地开发可用 http://localhost）");
  }
  if (url.hash) throw new HttpError(400, "invalid_request", "回调地址不能包含 fragment");
  return result;
}
