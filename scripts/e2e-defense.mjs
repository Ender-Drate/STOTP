const BASE = process.env.AUTH_BASE_URL || "http://127.0.0.1:3100";
const ORIGIN = BASE;
const TEST_IP = "203.0.113.50";
let failures = 0;

function ok(condition, label, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? ` · ${extra}` : ""}`);
  if (!condition) failures += 1;
}

function cookieOf(res) {
  return (res.headers.getSetCookie ? res.headers.getSetCookie() : [])
    .map((item) => item.split(";")[0]).join("; ");
}

async function json(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    redirect: "manual",
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return { res, body, text, cookie: cookieOf(res) };
}

const login = await json("/api/auth/login", {
  method: "POST",
  headers: { Origin: ORIGIN },
  body: JSON.stringify({
    username: "admin",
    password: process.env.AUTH_ADMIN_PASSWORD || "admin1234",
  }),
});
ok(login.res.status === 200, "admin login");
const adminCookie = login.cookie;

const initial = await json("/api/admin/risk/defense", {
  headers: { Cookie: adminCookie },
});
ok(initial.res.status === 200 && initial.body?.enabled === false,
  "active defense starts disabled");

const enabled = await json("/api/admin/risk/defense", {
  method: "PATCH",
  headers: { Cookie: adminCookie, Origin: ORIGIN },
  body: JSON.stringify({ enabled: true }),
});
ok(enabled.res.status === 200 && enabled.body?.enabled === true,
  "active defense enabled");

const observe = await json("/api/risk/observe", {
  method: "POST",
  headers: { Cookie: adminCookie, Origin: ORIGIN, "X-Real-IP": TEST_IP },
  body: JSON.stringify({
    path: "/login",
    signals: {
      webdriver: true,
      cdp: true,
      headless: true,
      platform: "",
      languages: [],
      timezone: "",
      screen: { width: 0, height: 0, colorDepth: 0 },
      screenAvail: { width: 0, height: 0 },
      hardwareConcurrency: 0,
      plugins: 0,
      mimeTypes: 0,
      outerWidth: 0,
      outerHeight: 0,
      chrome: false,
    },
  }),
});
ok(observe.res.status === 200, "automation observation accepted");

const listed = await json("/api/admin/risk/defense", {
  headers: { Cookie: adminCookie },
});
const defense = listed.body?.defenses?.find((item) => item.ip === TEST_IP);
ok(Boolean(defense), "risky IP appears in active defense list");
ok(defense?.action === "block", "critical automation gets a block", defense?.action);
ok(defense?.remaining > 0 && defense?.remaining <= 900,
  "defense duration is capped at 15 minutes", String(defense?.remaining || ""));

const blocked = await json("/api/auth/login", {
  method: "POST",
  headers: { Origin: ORIGIN, "X-Real-IP": TEST_IP },
  body: JSON.stringify({ username: "admin", password: "wrong-password" }),
});
ok(blocked.res.status === 403 && blocked.body?.defense_action === "block",
  "defended IP is blocked from login", String(blocked.res.status));
const retryAfter = Number(blocked.res.headers.get("retry-after") || 0);
ok(retryAfter > 0 && retryAfter <= 900,
  "Retry-After is set and capped", String(retryAfter));

const cleared = await json(
  `/api/admin/risk/defense?ip=${encodeURIComponent(TEST_IP)}`,
  { method: "DELETE", headers: { Cookie: adminCookie, Origin: ORIGIN } },
);
ok(cleared.res.status === 200 && cleared.body?.cleared === true,
  "active defense can be cleared");
const afterClear = await json("/api/auth/login", {
  method: "POST",
  headers: { Origin: ORIGIN, "X-Real-IP": TEST_IP },
  body: JSON.stringify({ username: "defense_probe", password: "wrong-password" }),
});
ok(afterClear.res.status !== 403 && afterClear.body?.defense_action !== "block",
  "cleared IP is no longer blocked", String(afterClear.res.status));

const throttleIp = "203.0.113.51";
const throttleObserve = await json("/api/risk/observe", {
  method: "POST",
  headers: { Origin: ORIGIN, "X-Real-IP": throttleIp },
  body: JSON.stringify({
    path: "/login",
    signals: {
      webdriver: true,
      cdp: true,
      headless: true,
      languages: [],
      timezone: "",
      screen: { width: 0, height: 0 },
      screenAvail: { width: 0, height: 0 },
      plugins: 0,
    },
  }),
});
ok(throttleObserve.res.status === 200, "anonymous automation observation accepted");
const throttledList = await json("/api/admin/risk/defense", {
  headers: { Cookie: adminCookie },
});
const throttle = throttledList.body?.defenses?.find((item) => item.ip === throttleIp);
ok(throttle?.action === "throttle", "medium automation gets a throttle", throttle?.action);
const throttled = await json("/api/auth/login", {
  method: "POST",
  headers: { Origin: ORIGIN, "X-Real-IP": throttleIp },
  body: JSON.stringify({ username: "admin", password: "wrong-password" }),
});
ok(throttled.res.status === 429 && throttled.body?.defense_action === "throttle",
  "throttled IP gets 429", String(throttled.res.status));
ok(Number(throttled.res.headers.get("retry-after") || 0) > 0,
  "throttle sets Retry-After");
await json(`/api/admin/risk/defense?ip=${encodeURIComponent(throttleIp)}`, {
  method: "DELETE", headers: { Cookie: adminCookie, Origin: ORIGIN },
});

const disabled = await json("/api/admin/risk/defense", {
  method: "PATCH",
  headers: { Cookie: adminCookie, Origin: ORIGIN },
  body: JSON.stringify({ enabled: false }),
});
ok(disabled.res.status === 200 && disabled.body?.enabled === false,
  "active defense disabled");
const final = await json("/api/admin/risk/defense", {
  headers: { Cookie: adminCookie },
});
ok((final.body?.defenses || []).length === 0, "disabling clears active defenses");

console.log(failures === 0 ? "\nALL ACTIVE DEFENSE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
