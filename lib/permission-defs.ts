export const PERMISSION_DEFS = [
  { key: "admin.access", label: "访问管理台", group: "基础" },
  { key: "users.view", label: "查看用户列表", group: "用户" },
  { key: "users.manage", label: "编辑用户资料/角色", group: "用户" },
  { key: "users.disable", label: "禁用 / 重新启用用户", group: "用户" },
  { key: "oauth.apps.manage", label: "接入 OAuth2 应用", group: "应用" },
  { key: "login.providers.manage", label: "管理外部登录服务", group: "应用" },
  { key: "stotp.bind", label: "绑定 STOTP 设备", group: "STOTP" },
  { key: "stotp.manage", label: "管理他人 STOTP 绑定", group: "STOTP" },
  { key: "stats.view", label: "查看统计", group: "系统" },
  { key: "audit.view", label: "查看审计", group: "系统" },
  { key: "risk.manage", label: "管理 IP 观察/封禁", group: "系统" },
] as const;

export type PermissionKey = (typeof PERMISSION_DEFS)[number]["key"];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_DEFS.map((item) => item.key);

export const PERMISSION_GROUPS = Array.from(
  new Set(PERMISSION_DEFS.map((item) => item.group))
);

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  superadmin: ALL_PERMISSION_KEYS,
  admin: [
    "admin.access",
    "users.view",
    "users.manage",
    "users.disable",
    "oauth.apps.manage",
    "stotp.bind",
    "stotp.manage",
    "stats.view",
    "audit.view",
  ],
  user: ["stotp.bind"],
};
