export type CaptchaLang = "zh" | "en";

/** Language for the prompt rendered into the CAPTCHA image. */
export function captchaLanguage(): CaptchaLang {
  try {
    const saved = window.localStorage.getItem("stotp-lang");
    if (saved === "zh" || saved === "en") return saved;
    return (window.navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}

/**
 * Only the challenge purpose and locale are sent. The challenge token itself
 * lives in an HttpOnly cookie, so JavaScript never sees a credential.
 */
export function captchaUrl(purpose: string): string {
  return `/api/auth/captcha?purpose=${encodeURIComponent(purpose)}&lang=${captchaLanguage()}`;
}
