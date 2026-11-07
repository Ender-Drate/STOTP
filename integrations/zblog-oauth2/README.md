# Z-BlogPHP 通用 OAuth2 登录插件

一个插件内可配置**多个 OAuth2 / OIDC Provider**，每个 Provider 在 Z-Blog 登录页显示自己的按钮。
不绑定 STOTP，也不要求 auth-center；任何标准 OAuth2 用户信息接口都可以接。

## 安装

把 `STOTPOAuth/` 复制到：

```text
<zblog-root>/zb_users/plugin/STOTPOAuth/
```

或后台上传 `STOTPOAuth.zip`。启用「OAuth2 通用登录」后，在插件设置里添加 Provider。

## 添加 Provider

后台 → 插件 → OAuth2 通用登录 → 添加 Provider。

必填：

- 名称、Slug（如 `github`、`google`、`auth-center`）
- Authorization URL
- Token URL
- UserInfo URL
- Client ID / Client Secret（公共客户端可以留空 Secret）

可选：

- 图标 URL
- Scope
- Token 认证方式：`client_secret_post` / `client_secret_basic`
- UserInfo GET/POST
- PKCE（S256）
- 额外授权参数，例如 `prompt=consent&access_type=offline`
- 字段映射：Subject / Email / Name / Email Verified，支持 `data.id` 这种点路径
- 信任邮箱：Provider 不返回 `email_verified` 时，管理员可显式信任
- 排序、启用

回调地址对所有 Provider 相同：

```text
https://你的博客域名/zb_users/plugin/STOTPOAuth/oauth2.php
```

把该地址填到每个 OAuth2 服务的回调白名单。

## Provider 示例

### auth-center / STOTP

```text
Authorization: https://auth.yxzhou.com/api/oauth/authorize
Token:         https://auth.yxzhou.com/api/oauth/token
UserInfo:      https://auth.yxzhou.com/api/oauth/userinfo
Scope:         openid profile email
Subject:       sub
Email Verified: email_verified
Token 认证:    client_secret_post
PKCE:          开
```

### GitHub

```text
Authorization: https://github.com/login/oauth/authorize
Token:         https://github.com/login/oauth/access_token
UserInfo:      https://api.github.com/user
Scope:         read:user user:email
Subject:       id
Email:         email
Name:          name
Token 认证:    client_secret_post
PKCE:          可开（GitHub 会忽略）
```

GitHub 的 `/user` 可能不返回邮箱，需要 `user:email` scope，或另建一个返回邮箱的 UserInfo 服务。
如果邮箱为空，插件不会自动建号。

### Google / 标准 OIDC

```text
Authorization: https://accounts.google.com/o/oauth2/v2/auth
Token:         https://oauth2.googleapis.com/token
UserInfo:      https://openidconnect.googleapis.com/v1/userinfo
Scope:         openid profile email
Subject:       sub
Email Verified: email_verified
```

### 自建 OAuth2

只要满足：

1. 支持授权码模式；
2. `POST` Token 端点返回 JSON 或 form-urlencoded，包含 `access_token`；
3. 带 `Authorization: Bearer <token>` 的 UserInfo 返回 JSON；
4. JSON 中有可映射的 Subject 和 Email。

## 登录流程

```text
登录页 → oauth2.php?action=start&provider=SLUG
       → Authorization URL（state + 可选 PKCE）
       → oauth2.php 回调
       → Token（post/basic）
       → UserInfo
       → 按 Provider + Subject 查绑定
       → 绑定/自动注册 Z-Blog 用户
       → SetLoginCookie()
```

- `state` 10 分钟一次性，绑定 PHP session。
- PKCE verifier 只存在 session。
- 不同 Provider 的 Subject 独立绑定，不会串号。
- 登录按钮通过 `Filter_Plugin_Login_Header` 注入，不改主题模板。

## 账号绑定

绑定表：`%pre%oauth2_links`，记录 Provider、MemberID、Subject、Email。

1. 已存在 `(Provider, Subject)`：直接登录。
2. 不存在：
   - `email_verified=true`（或管理员信任邮箱）、邮箱已存在、开启自动绑定 → 绑定已有账号；
   - 否则开启自动注册 → 创建新账号；
   - 邮箱已存在但关闭自动绑定 → 拒绝，避免接管账号。
3. 自动注册默认等级 5，可在全局设置改，范围 2-6，不会创建管理员。

## 全局设置

- 自动注册
- 已验证邮箱自动绑定
- 默认用户等级
- 登录后跳转（留空为 Z-Blog 后台）

## 安全

- 必须 HTTPS。
- state + PKCE（如果 Provider 支持）。
- Token 只在服务端交换，不下发浏览器。
- 错误信息 HTML 转义，不输出 token/secret。
- Client Secret 存在 Z-Blog 插件配置文件（通常在 `zb_users/data/plugin/`），请限制文件权限。
- 自动绑定只接受已验证邮箱；不支持 `email_verified` 的 Provider 需要管理员显式勾选「信任邮箱」。
- 公共客户端可以留空 Secret，但必须开启 PKCE。

## 常见问题

**登录页没有按钮**

- 没有启用的 Provider；
- Provider 的 Enabled 未勾选；
- 当前不是 Z-Blog 默认登录页。

**state 校验失败**

- 回调超过 10 分钟；
- 浏览器禁用 Cookie；
- 登录页和回调的域名/HTTPS/WWW 不一致，session Cookie 丢失。

**Token 失败**

- Client ID/Secret 或 Token 认证方式不对；
- 回调地址与 Provider 后台登记的不完全一致；
- 公共客户端没有开 PKCE。

**UserInfo 失败**

- UserInfo 需要 POST，或需要特殊 scope；
- 字段映射写错，比如 GitHub 的 Subject 是 `id` 而不是 `sub`。

**无法自动注册**

- 邮箱为空；
- 邮箱未验证且没有勾选「信任邮箱」；
- 默认等级或用户名/邮箱格式不符合 Z-Blog 设置。
