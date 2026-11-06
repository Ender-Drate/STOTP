/**
 * Phase 2–4 端到端：mock STOTP + 临时 auth-center 实例。
 *
 * 覆盖：注册（无绑定）→ 密码登录 → 绑定 → 密码 + OTP →
 *       错误码/重放/被篡改 assertion → 用户解绑 → 管理员解绑 → STOTP 不可达。
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { MOCK_CLIENT_ID, startMock } from "./mock-stotp.mjs";

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "admin1234";
const OTP = "123456";
const cwd = process.cwd();
let failures = 0;

function ok(condition, label, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? ` · ${extra}` : ""}`);
  if (!condition) failures += 1;
}

function cookieOf(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return list.map((item) => item.split(";")[0]).join("; ");
}

async function json(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    redirect: "manual",
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return { res, body, text, cookie: cookieOf(res) };
}

async function form(path, values, cookie = "") {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams(values).toString(),
    redirect: "manual",
  });
  return { res, cookie: cookieOf(res), location: res.headers.get("location") || "" };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitReady(child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`auth-center 退出：${child.exitCode}`);
    try {
      const res = await fetch(BASE + "/api/oauth/discovery");
      if (res.ok) return;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error("auth-center 启动超时");
}

if (!existsSync(join(cwd, ".next"))) {
  console.error("缺少 .next，请先 npm run build");
  process.exit(1);
}

const mock = await startMock();
const dataDir = mkdtempSync(join(tmpdir(), "stotp-auth-e2e-"));
const env = {
  ...process.env,
  NODE_ENV: "production",
  AUTH_PUBLIC_URL: BASE,
  AUTH_DATA_DIR: dataDir,
  AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD,
  STOTP_BASE_URL: mock.url,
  STOTP_LOGIN_CLIENT_ID: "srv_mock",
  STOTP_LOGIN_CLIENT_SECRET: "cs_mock_secret",
  STOTP_ENFORCE: "bound",
  STOTP_TIMEOUT_MS: "2000",
};
const child = spawn(process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)],
  { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
child.stderr.on("data", (chunk) => { logs += chunk.toString(); });

try {
  await waitReady(child);
  const suffix = randomBytes(4).toString("hex");
  const username = `stotp_e2e_${suffix}`;
  const password = "e2e-password-123";

  // 1. 注册：不要求绑定，直接拿到会话
  const reg = await json("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username, email: `${username}@example.com`, password, displayName: "STOTP E2E",
    }),
  });
  ok(reg.res.status === 200 && reg.cookie.includes("ac_session"), "register without STOTP");
  const userId = reg.body?.user?.id;
  const userCookie = reg.cookie;

  // 2. 未绑定：密码登录保持原行为
  const plainLogin = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember: false }),
  });
  ok(plainLogin.res.status === 200 && plainLogin.body?.ok === true
    && !plainLogin.body?.otp_required, "unbound password login unchanged");
  ok(plainLogin.cookie.includes("ac_session"), "unbound login sets session");

  // 3. 绑定：错误码拒绝，正确码成功
  const badBind = await json("/api/settings/stotp/bind", {
    method: "POST", headers: { Cookie: userCookie },
    body: JSON.stringify({ clientId: MOCK_CLIENT_ID, code: "000000" }),
  });
  ok(badBind.res.status === 400, "bind rejects wrong code");
  const bind = await json("/api/settings/stotp/bind", {
    method: "POST", headers: { Cookie: userCookie },
    body: JSON.stringify({ clientId: MOCK_CLIENT_ID, code: OTP }),
  });
  ok(bind.res.status === 200 && bind.body?.binding?.clientId === MOCK_CLIENT_ID,
    "bind with correct code");

  // 4. 退出后密码登录：必须 otp_required 且没有会话 cookie
  await json("/api/auth/logout", {
    method: "POST", headers: { Cookie: userCookie, Origin: BASE },
  });
  // 4. 无 JS 表单路径：登录 303 到 OTP 页，提交后 303 回 next
  const formLogin = await form("/api/auth/login", {
    username, password, next: "/dashboard",
  });
  ok(formLogin.res.status === 303 && formLogin.location.includes("/login/otp"),
    "native form login redirects to OTP page");
  const formTicket = new URL(formLogin.location).searchParams.get("ticket") || "";
  const formOtp = await form("/api/auth/login/otp", {
    ticket: formTicket, code: OTP, next: "/dashboard",
  });
  ok(formOtp.res.status === 303 && formOtp.location.endsWith("/dashboard")
    && formOtp.cookie.includes("ac_session"), "native OTP form creates session");
  const formMe = await json("/api/auth/me", { headers: { Cookie: formOtp.cookie } });
  ok(formMe.res.status === 200, "session from native OTP form valid");
  await json("/api/auth/logout", {
    method: "POST", headers: { Cookie: formOtp.cookie, Origin: BASE },
  });

  const step1 = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember: false }),
  });
  ok(step1.res.status === 200 && step1.body?.otp_required === true,
    "bound login asks for OTP");
  ok(!step1.cookie.includes("ac_session"), "no session before OTP");
  const ticket = step1.body?.ticket;

  // 5. 错误 OTP → 401；正确 OTP → 会话；同一 ticket 不能复用
  const badOtp = await json("/api/auth/login/otp", {
    method: "POST",
    body: JSON.stringify({ ticket, code: "000000", next: "/dashboard" }),
  });
  ok(badOtp.res.status === 401, "wrong OTP rejected");
  const goodOtp = await json("/api/auth/login/otp", {
    method: "POST",
    body: JSON.stringify({ ticket, code: OTP, next: "/dashboard" }),
  });
  ok(goodOtp.res.status === 200 && goodOtp.cookie.includes("ac_session"),
    "correct OTP creates session");
  const otpCookie = goodOtp.cookie;
  const me = await json("/api/auth/me", { headers: { Cookie: otpCookie } });
  ok(me.res.status === 200 && me.body?.user?.username === username, "session after OTP valid");
  const replay = await json("/api/auth/login/otp", {
    method: "POST",
    body: JSON.stringify({ ticket, code: OTP, next: "/dashboard" }),
  });
  ok(replay.res.status === 401, "OTP ticket is single-use");

  // 6. 被篡改的 assertion → 502，且不建会话
  const step2 = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember: false }),
  });
  const tampered = await json("/api/auth/login/otp", {
    method: "POST",
    body: JSON.stringify({ ticket: step2.body?.ticket, code: "999999", next: "/dashboard" }),
  });
  ok(tampered.res.status === 502 && !tampered.cookie.includes("ac_session"),
    "tampered assertion rejected");

  const audStep = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember: false }),
  });
  const wrongAud = await json("/api/auth/login/otp", {
    method: "POST",
    body: JSON.stringify({ ticket: audStep.body?.ticket, code: "888888", next: "/dashboard" }),
  });
  ok(wrongAud.res.status === 502, "wrong assertion aud rejected");

  const expStep = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember: false }),
  });
  const expired = await json("/api/auth/login/otp", {
    method: "POST",
    body: JSON.stringify({ ticket: expStep.body?.ticket, code: "777777", next: "/dashboard" }),
  });
  ok(expired.res.status === 502, "expired assertion rejected");

  // 同一 client_id 不能绑定到第二个用户
  const other = await json("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: `${username}_b`, email: `${username}_b@example.com`,
      password, displayName: "Other",
    }),
  });
  const duplicate = await json("/api/settings/stotp/bind", {
    method: "POST", headers: { Cookie: other.cookie },
    body: JSON.stringify({ clientId: MOCK_CLIENT_ID, code: OTP }),
  });
  ok(duplicate.res.status === 409, "client_id cannot bind to two users");

  // 7. 用户解绑 → 密码登录恢复
  const unbind = await json("/api/settings/stotp/unbind", {
    method: "POST", headers: { Cookie: otpCookie },
  });
  ok(unbind.res.status === 200, "user unbind");
  await json("/api/auth/logout", {
    method: "POST", headers: { Cookie: otpCookie, Origin: BASE },
  });
  const afterUnbind = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember: false }),
  });
  ok(afterUnbind.res.status === 200 && !afterUnbind.body?.otp_required,
    "password-only login after unbind");
  const afterUnbindCookie = afterUnbind.cookie;

  // 8. 管理员解绑
  const rebind = await json("/api/settings/stotp/bind", {
    method: "POST", headers: { Cookie: afterUnbindCookie },
    body: JSON.stringify({ clientId: MOCK_CLIENT_ID, code: OTP }),
  });
  ok(rebind.res.status === 200, "rebind for admin test");
  const admin = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
  });
  ok(admin.res.status === 200, "admin login");
  const adminUnbind = await json(`/api/admin/users/${userId}/stotp`, {
    method: "DELETE", headers: { Cookie: admin.cookie, Origin: BASE },
  });
  ok(adminUnbind.res.status === 200 && adminUnbind.body?.removed === true,
    "admin unbind");

  // 9. STOTP 不可达：绑定用户 fail closed，未绑定不受影响
  const rebind2 = await json("/api/settings/stotp/bind", {
    method: "POST", headers: { Cookie: afterUnbindCookie },
    body: JSON.stringify({ clientId: MOCK_CLIENT_ID, code: OTP }),
  });
  ok(rebind2.res.status === 200, "rebind before outage");
  await mock.close();
  const outageStep = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember: false }),
  });
  ok(outageStep.res.status === 200 && outageStep.body?.otp_required === true,
    "bound login during outage asks OTP");
  const outageOtp = await json("/api/auth/login/otp", {
    method: "POST",
    body: JSON.stringify({ ticket: outageStep.body?.ticket, code: OTP, next: "/dashboard" }),
  });
  ok(outageOtp.res.status === 503, "STOTP outage fails closed (503)");
} catch (error) {
  failures += 1;
  console.error("E2E ERROR:", error.message);
  console.error(logs.split("\n").slice(-20).join("\n"));
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  await new Promise((done) => {
    if (child.exitCode !== null) return done();
    const timer = setTimeout(done, 2000);
    child.once("exit", () => { clearTimeout(timer); done(); });
  });
  try { await mock.close(); } catch { /* already closed */ }
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`[cleanup] 临时目录未删除：${dataDir}（${error.code || error.message}）`);
  }
}

console.log(failures === 0 ? "\nALL STOTP CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
