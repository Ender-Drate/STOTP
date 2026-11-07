# 安全审计整改记录

对应报告：`STOTP-安全审计报告.md`（commit `28acd78`）。
本次只处理 **Web/auth-center 与 Z-Blog 插件**；按运营方要求，`android/` 不再维护，M-7/L-10 不在范围。

## 状态总表

| 编号 | 状态 | 整改 |
| --- | --- | --- |
| H-1 | 已修复 | `clientIp()` 只读取 nginx 覆盖的 `X-Real-IP`；兼容多层代理重复追加的逗号列表；完全移除 `CF-Connecting-IP` / `X-Forwarded-For` / `Forwarded` 信任 |
| M-1 | 已修复 | `safeNextPath()` 拒绝反斜杠、编码反斜杠/斜杠、控制字符，并校验同源 |
| M-2 | 已修复 | `/api/oauth/head` 改为 HMAC 签名 URL；只输出 SVG，不 302 到用户 URL；OIDC `picture` 也改为签名地址 |
| M-3 | 已修复 | Next + nginx 增加 CSP、XFO、nosniff、Referrer-Policy、Permissions-Policy、HSTS；关闭 X-Powered-By；`form-action 'self' https:` 允许 OAuth 回调重定向 |
| M-4 | 已缓解 | 增加同源校验、IP/全局限速；未登录客户端信号最高 55 分，不能刷 critical |
| M-5 | 已大幅缓解 | 登录不存在账号也执行 dummy scrypt；账号维度限速/失败计数/CAPTCHA；禁用账号统一 401；头像签名消除 ID 枚举 |
| M-6 | 已修复声明 | 新增 `users.email_verified`，默认 0；OIDC/userinfo 不再硬编码 true；改邮箱自动清零 |
| M-7 | 不处理 | Android 已停用 |
| M-8 | 已修复 | Z-Blog 插件 `allow_email_link` 默认 0；`email_verified` 严格布尔匹配 |
| L-1 | 已修复 | logout 增加 `assertSameOrigin` |
| L-2 | 已修复 | 生产 HTTPS 默认拒绝明文密码 API；`AUTH_REQUIRE_ENCRYPTED_PASSWORD=0` 可显式回退 |
| L-3 | 已修复 | CSV 对 `= + - @ \t \r` 开头单元格加 `'` 前缀 |
| L-4 | 已修复 | 验证码先比对再置 used；5 位；账号维度失败计数 |
| L-5 | 已修复 | HTTPS 下 Cookie 改名 `__Host-ac_session`；HSTS 加 includeSubDomains |
| L-6 | 已修复 | `poweredByHeader:false`；nginx `server_tokens off` / `proxy_hide_header X-Powered-By` |
| L-7 | 已修复 | `/api/oauth/head`、`/api/oauth/token`、`/api/auth/captcha`、`/api/risk/observe` 补限速 |
| L-8 | 部分修复 | 密码最小长度 10；仍未接入 HIBP/zxcvbn、管理员强制 MFA、失败锁定 |
| L-9 | 已修复 | `next.config.ts` 启动时拒绝生产环境 `AUTH_E2E=1` |
| L-10 | 不处理 | Android 已停用 |

## 关键行为变化

### 1. 生产必须由 nginx 覆盖 `X-Real-IP`

应用不再读取任何其他转发头。直接暴露 Node 时应设置：

```bash
AUTH_TRUST_PROXY=0
```

nginx 必须：

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header CF-Connecting-IP $remote_addr;
proxy_set_header Forwarded "";
```

完整配置见 `docs/nginx-auth-center.conf`。

### 2. 生产默认要求 RSA 信封加密

`NODE_ENV=production` 且 `AUTH_PUBLIC_URL=https://...` 时，明文密码 API 返回 `426`。
需要兼容旧脚本时显式设置：

```bash
AUTH_REQUIRE_ENCRYPTED_PASSWORD=0
```

不推荐。

### 3. 邮箱验证状态

没有邮箱验证流程，因此：

- 新注册用户 `email_verified = 0`；
- OIDC `email_verified = false`；
- 改邮箱后自动清零；
- Z-Blog 插件默认**不按邮箱自动绑定**。

下游应用不能仅凭邮箱自动关联账号，除非自己完成邮箱验证。

### 4. 头像接口

旧地址：

```text
/api/oauth/head?uid=1
```

现在返回 404。OIDC `picture` 使用签名地址：

```text
/api/oauth/head?uid=1&sig=...
```

签名由 `data/avatar-secret`（或 `AUTH_AVATAR_SECRET`）生成，不跳转外部 URL。

### 5. 72h IP 与观察规则

- 访问 IP 列表只统计 `visitWindowHours`（默认 72h）内的观测/审计；
- `watch` 观察规则默认 72h 到期，`listIpRules()` 自动清理过期规则；
- `block` 封禁规则默认长期，除非 API 显式传 `expiresAt`；
- `X-Real-IP: 1.2.3.4, 1.2.3.4` 会取第一个合法 IP，不会退回 127.0.0.1。

## 仍未解决/需要产品决策

1. **注册枚举**：邮箱/用户名唯一性仍会通过“成功 vs 失败”被探测；彻底修复需要邮箱验证后异步告知，当前没有邮件服务。
2. **管理员 MFA**：未强制 superadmin 绑定 TOTP/Passkey。
3. **失败锁定**：未做账号级长时间锁定，避免被用来 DoS；目前依赖限速 + 账号 CAPTCHA。
4. **客户端风控信号**：仍然是客户端自报，未登录时已限制最高分，但不能作为强对抗信号。
5. **多实例**：限速仍是进程内 Map，多实例部署需要 Redis/数据库令牌桶。

## 验证

```text
npm run build           通过
npm run e2e             ALL CHECKS PASSED
npm run e2e:security    ALL SECURITY CHECKS PASSED
npm run e2e:captcha     ALL CAPTCHA CHECKS PASSED
npm run e2e:encrypted   ALL ENCRYPTED PASSWORD CHECKS PASSED
npm run e2e:sessions    ALL SESSION CHECKS PASSED
npm run e2e:risk        ALL RISK CHECKS PASSED
npm run e2e:rbac        ALL RBAC CHECKS PASSED
```

`e2e:security` 覆盖：安全头、伪造 CF/XFF、明文/编码反斜杠开放重定向、跨站 logout、
未登录风控分数封顶、换 IP 仍触发账号 CAPTCHA、CSV 公式注入。
