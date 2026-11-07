# Z-BlogPHP OAuth2 登录插件

把 Z-BlogPHP 的后台登录接到 **STOTP auth-center**。使用 OAuth2 授权码 + PKCE，不保存第三方密码。

## 安装

1. 把 `STOTPOAuth/` 整个目录复制到：

```text
<zblog-root>/zb_users/plugin/STOTPOAuth/
```

2. Z-Blog 后台 → 插件 → 启用「STOTP OAuth2 登录」。
3. 进入插件设置，填写 auth-center 的 OAuth2 Client。

也可以直接上传 `STOTPOAuth.zip` 安装（zip 根目录必须是 `STOTPOAuth/`）。

## auth-center 侧配置

在 auth-center 后台「OAuth2 应用」创建应用：

| 字段 | 值 |
| --- | --- |
| 回调地址 | `https://你的博客域名/zb_users/plugin/STOTPOAuth/oauth2.php` |
| Scope | `openid profile email` |

拿到 `Client ID` / `Client Secret` 填到 Z-Blog 插件设置。

插件默认端点：

```text
Authorization: https://auth.yxzhou.com/api/oauth/authorize
Token:         https://auth.yxzhou.com/api/oauth/token
UserInfo:      https://auth.yxzhou.com/api/oauth/userinfo
```

如果你的 auth-center 不是这个域名，在插件设置里改。

## 登录流程

```text
Z-Blog 登录页
  → /zb_users/plugin/STOTPOAuth/oauth2.php?action=start
  → auth-center /api/oauth/authorize（state + PKCE S256）
  → 回调 oauth2.php
  → /api/oauth/token（code + code_verifier）
  → /api/oauth/userinfo
  → 绑定/创建 Z-Blog 用户
  → SetLoginCookie()
  → 后台
```

- `state` 10 分钟一次性，绑定 PHP session。
- PKCE verifier 只存在 session。
- 登录按钮通过 `Filter_Plugin_Login_Header` 注入，不改主题模板。
- 登录成功后调用 Z-Blog 官方 `SetLoginCookie()`。

## 账号绑定逻辑

1. 已有 `sub` 绑定：直接登录对应 Z-Blog 用户。
2. 没有绑定：
   - 如果 `email_verified=true`、邮箱已存在且开启「已验证邮箱自动绑定」→ 绑定并登录；
   - 否则开启「自动注册」时创建新 Z-Blog 用户；
   - 邮箱不存在且关闭自动注册 → 拒绝并提示。
3. 自动注册不会创建管理员，默认等级 5，可在插件设置调整。
4. 绑定表：`%pre%stotp_oauth_links`，保存 `MemberID`、`SubjectHash`、邮箱。

## 配置项

- Authorization / Token / UserInfo URL
- Client ID / Client Secret
- Scope
- 登录按钮文字
- 自动注册
- 已验证邮箱自动绑定
- 默认用户等级
- 登录后跳转（留空为后台首页）

Client Secret 保存在 Z-Blog 插件配置文件中（通常是 `zb_users/data/plugin/STOTPOAuth.php`），
请限制文件权限，不要把 `zb_users` 暴露为可写目录。

## 安全说明

- 必须使用 **HTTPS**；HTTP 下 OAuth2 授权码和 Token 都可能被截获。
- 插件使用 `state` + PKCE，不把 Client Secret 放在浏览器。
- 不在页面/日志输出 access_token、密码或 Client Secret。
- 自动绑定只接受 `email_verified=true` 的邮箱。
- 如果 auth-center 使用 GitHub 等外部登录，需要先在 auth-center 完成本地账号绑定；
  这里绑定的是 auth-center 的 `sub` 与 Z-Blog 用户。

## 常见问题

**登录按钮不显示**

- 插件未启用；
- Client ID 为空；
- 当前不是 Z-Blog 默认登录页（`zb_system/login.php`）。

**state 校验失败 / 会话过期**

- 回调超过 10 分钟；
- 浏览器禁用了 Cookie；
- 站点 HTTPS/WWW 域名不一致，导致 session Cookie 丢失。回调域名必须和登录页完全一致。

**换取 Token 失败**

- Client ID / Secret 错误；
- 回调地址和 auth-center 中登记的 redirect_uri 不完全一致；
- auth-center 未启用该应用或应用被删除。

**邮箱已存在但不能绑定**

- auth-center UserInfo 没有返回 `email_verified=true`；
- 或插件关闭了「已验证邮箱自动绑定」。此时请用已有账号登录，或改用未占用邮箱。

**自动注册失败**

- 用户名/邮箱格式或长度不符合 Z-Blog 设置；
- 邮箱已被其他会员使用；
- 默认用户等级配置不合适。
