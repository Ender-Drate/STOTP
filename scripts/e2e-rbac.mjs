/**
 * 权限分级端到端：需要 auth-center 已启动。
 * 覆盖：自定义权限等级、节点校验、角色分配、页面/API 权限、禁用/启用、系统角色保护。
 */
import { randomBytes } from "node:crypto";

const BASE = process.env.AUTH_BASE_URL || "http://127.0.0.1:3100";
const ADMIN_PASSWORD = process.env.AUTH_ADMIN_PASSWORD || "admin1234";
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
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    redirect: "manual",
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return { res, body, text, cookie: cookieOf(res) };
}

async function page(path, cookie) {
  const res = await fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {} });
  return { res, text: await res.text() };
}

const suffix = randomBytes(4).toString("hex");
const password = "rbac-password-123";

const admin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
});
ok(admin.res.status === 200 && admin.body?.user?.role === "superadmin",
  "admin migrated to superadmin", admin.body?.user?.role);
const adminCookie = admin.cookie;

const roles0 = await json("/api/admin/roles", { headers: { Cookie: adminCookie } });
ok(roles0.res.status === 200, "super can list roles");
const superRole = roles0.body?.roles?.find((role) => role.key === "superadmin");
const systemAdminRole = roles0.body?.roles?.find((role) => role.key === "admin");
ok(Boolean(superRole) && Boolean(systemAdminRole), "system roles seeded");

const invalid = await json("/api/admin/roles", {
  method: "POST", headers: { Cookie: adminCookie },
  body: JSON.stringify({ name: "坏角色", permissions: ["not.a.real.node"] }),
});
ok(invalid.res.status === 400, "invalid permission node rejected");

const appRole = await json("/api/admin/roles", {
  method: "POST", headers: { Cookie: adminCookie },
  body: JSON.stringify({
    name: `应用管理员 ${suffix}`,
    description: "只能管理 OAuth2 应用",
    permissions: ["oauth.apps.manage", "users.view"],
  }),
});
ok(appRole.res.status === 201, "create custom app role", appRole.body?.role?.key);
const appRoleId = appRole.body?.role?.id;

const userRole = await json("/api/admin/roles", {
  method: "POST", headers: { Cookie: adminCookie },
  body: JSON.stringify({
    name: `用户管理员 ${suffix}`,
    permissions: ["users.view", "users.disable"],
  }),
});
ok(userRole.res.status === 201, "create custom user role");
const userRoleId = userRole.body?.role?.id;

const unusedRole = await json("/api/admin/roles", {
  method: "POST", headers: { Cookie: adminCookie },
  body: JSON.stringify({ name: `临时角色 ${suffix}`, permissions: ["stats.view"] }),
});
ok(unusedRole.res.status === 201, "create unused role");

const editable = await json("/api/admin/roles", {
  method: "POST", headers: { Cookie: adminCookie },
  body: JSON.stringify({ name: `可编辑角色 ${suffix}`, permissions: ["stats.view"] }),
});
const edited = await json(`/api/admin/roles/${editable.body.role.id}`, {
  method: "PATCH", headers: { Cookie: adminCookie },
  body: JSON.stringify({ name: `已改角色 ${suffix}`, permissions: ["users.view"] }),
});
ok(edited.res.status === 200
  && edited.body?.role?.name === `已改角色 ${suffix}`
  && edited.body?.role?.permissionsList?.includes("users.view"),
  "created role nodes can be edited");

const systemEdit = await json(`/api/admin/roles/${superRole.id}`, {
  method: "PATCH", headers: { Cookie: adminCookie },
  body: JSON.stringify({ name: "改名", permissions: ["stats.view"] }),
});
ok(systemEdit.res.status === 403, "superadmin role is immutable");

const inUse = await json(`/api/admin/roles/${unusedRole.body.role.id}`, {
  method: "DELETE", headers: { Cookie: adminCookie },
});
ok(inUse.res.status === 200, "delete unused custom role");

async function register(tag) {
  const username = `rbac_${tag}_${suffix}`;
  const result = await json("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username, email: `${username}@example.com`, password, displayName: tag,
    }),
  });
  return { username, id: result.body?.user?.id, cookie: result.cookie };
}

const alice = await register("alice");
const bob = await register("bob");
const carol = await register("carol");

async function assign(userId, roleId, cookie = adminCookie) {
  return json(`/api/admin/users/${userId}`, {
    method: "PATCH", headers: { Cookie: cookie },
    body: JSON.stringify({ roleId }),
  });
}
ok((await assign(alice.id, appRoleId)).res.status === 200, "assign app role");
ok((await assign(bob.id, userRoleId)).res.status === 200, "assign user role");

const aliceLogin = await json("/api/auth/login", {
  method: "POST", body: JSON.stringify({ username: alice.username, password }),
});
ok(aliceLogin.res.status === 200 && aliceLogin.body?.user?.roleName?.includes("应用管理员"),
  "assigned role visible at login", aliceLogin.body?.user?.roleName);
const aliceCookie = aliceLogin.cookie;

const apps = await json("/api/admin/apps", { headers: { Cookie: aliceCookie } });
ok(apps.res.status === 200, "app manage permission grants /api/admin/apps");
const statsDenied = await json("/api/admin/stats", { headers: { Cookie: aliceCookie } });
ok(statsDenied.res.status === 403, "missing stats.view is denied");
const rolesDenied = await json("/api/admin/roles", { headers: { Cookie: aliceCookie } });
ok(rolesDenied.res.status === 403, "non-super cannot list roles");
const createDenied = await json("/api/admin/roles", {
  method: "POST", headers: { Cookie: aliceCookie },
  body: JSON.stringify({ name: "x", permissions: ["stats.view"] }),
});
ok(createDenied.res.status === 403, "non-super cannot create roles");

const aliceUsersPage = await page("/dashboard/users", aliceCookie);
ok(aliceUsersPage.res.status === 200 && aliceUsersPage.text.includes("用户管理")
  && !aliceUsersPage.text.includes("当前权限等级不能查看用户列表"),
  "users.view renders user management");
const aliceAppsPage = await page("/dashboard/apps", aliceCookie);
ok(aliceAppsPage.res.status === 200 && aliceAppsPage.text.includes("OAuth2 应用"),
  "oauth permission renders app management");
const aliceRolesPage = await page("/dashboard/roles", aliceCookie);
ok(aliceRolesPage.text.includes("只有最高管理员"), "non-super is blocked from roles page");

const aliceAssign = await assign(carol.id, userRoleId, aliceCookie);
ok(aliceAssign.res.status === 403, "non-super cannot assign roles");
const aliceDisable = await json(`/api/admin/users/${carol.id}`, {
  method: "PATCH", headers: { Cookie: aliceCookie },
  body: JSON.stringify({ status: "disabled" }),
});
ok(aliceDisable.res.status === 403, "app role cannot disable users");

const bobLogin = await json("/api/auth/login", {
  method: "POST", body: JSON.stringify({ username: bob.username, password }),
});
const bobCookie = bobLogin.cookie;
const bobDisable = await json(`/api/admin/users/${carol.id}`, {
  method: "PATCH", headers: { Cookie: bobCookie },
  body: JSON.stringify({ status: "disabled" }),
});
ok(bobDisable.res.status === 200, "users.disable can disable user");
const carolLogin = await json("/api/auth/login", {
  method: "POST", body: JSON.stringify({ username: carol.username, password }),
});
ok(carolLogin.res.status === 401, "disabled user cannot login");
const bobEnable = await json(`/api/admin/users/${carol.id}`, {
  method: "PATCH", headers: { Cookie: bobCookie },
  body: JSON.stringify({ status: "active" }),
});
ok(bobEnable.res.status === 200, "users.disable can re-enable user");

const bobAssign = await assign(carol.id, appRoleId, bobCookie);
ok(bobAssign.res.status === 403, "user-admin cannot assign roles");

const inUseDelete = await json(`/api/admin/roles/${appRoleId}`, {
  method: "DELETE", headers: { Cookie: adminCookie },
});
ok(inUseDelete.res.status === 409, "role in use cannot be deleted");

const selfDemote = await json("/api/admin/users/1", {
  method: "PATCH", headers: { Cookie: adminCookie },
  body: JSON.stringify({ roleId: systemAdminRole.id }),
});
ok(selfDemote.res.status === 400, "super cannot change own role");

console.log(failures === 0 ? "\nALL RBAC CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
