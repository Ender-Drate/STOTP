# Z-BlogPHP 通用 OAuth2 / Passkey 登录插件

一个插件内可配置多个 OAuth2 / OIDC Provider；支持通过 STOTP Passkey 发起登录。
插件不会按邮箱查找本地账号：第三方身份必须显式绑定到 Z-Blog 本地账号。

## 安装

把 `STOTPOAuth/` 复制到：

```text
<zblog-root>/zb_users/plugin/STOTPOAuth/
```

或后台上传 `STOTPOAuth.zip`。启用「OAuth2 通用登录」后，在插件设置里添加 Provider。

## 添加 Provider

后台 → 插件 → OAuth2 通用登录 → 添加 Provider。

必填：

- 名称、Slug（如 `stotp`、`github`、`google`）
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
- 字段映射：Subject / Email / Name
- 排序、启用

回调地址对所有 Provider 相同：

```text
https://你的博客域名/zb_users/plugin/STOTPOAuth/oauth2.php
```

把该地址填到每个 OAuth2 服务的回调白名单。

## Passkey 登录

Passkey 依赖 STOTP 登录页，不是 Z-Blog 本地 WebAuthn。

1. 添加 STOTP Provider，例如 Slug `stotp`。
2. 全局设置里勾选「Passkey 登录」，选择该 Provider。
3. Passkey 登录入口留空时自动使用 Provider 域名 + `/login`；也可以显式填写，例如：
   `https://auth.example.com/login`
4. 登录页会出现「使用 Passkey 登录」按钮。

流程：

```text
Z-Blog Passkey 按钮
  → oauth2.php?action=start&passkey=1&provider=stotp
  → STOTP /login?method=passkey&next=/api/oauth/authorize?...
  → STOTP 自动发起 WebAuthn
  → OAuth 回调
  → 已绑定则登录；未绑定进入绑定页
```

硬件安全密钥如果不是 discoverable credential，可能需要在 STOTP 登录页填写用户名后再点一次 Passkey。

## 本地账号绑定（强制）

绑定表：`%pre%oauth2_links`，记录 Provider、MemberID、Subject、Email。

1. 已存在 `(Provider, Subject)`：直接登录，不检查邮箱。
2. 不存在：跳转绑定页，必须输入本地 Z-Blog **用户名 + 密码**。
3. 绑定成功后写入 link，后续同一 subject 直接登录。
4. 不会自动注册，也不会按邮箱自动绑定已有账号。
5. 一个 subject 已绑定其他本地账号时拒绝改绑。

邮箱只作为绑定记录/展示信息，不参与身份判断。

## 全局设置

- Passkey 登录开关
- Passkey Provider
- Passkey 登录入口（可选）
- 登录后跳转（留空为 Z-Blog 后台）

## 安全

- 必须 HTTPS。
- state + PKCE（如果 Provider 支持）。
- Token 只在服务端交换，不下发浏览器。
- 错误信息 HTML 转义，不输出 token/secret。
- Client Secret 存在 Z-Blog 插件配置文件（通常在 `zb_users/data/plugin/`），请限制文件权限。
- 绑定必须验证本地用户名和密码；绑定 token 10 分钟一次性有效。
- 不使用 email 匹配/接管本地账号。
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

**首次登录要求绑定**

- 这是预期行为；请使用已有 Z-Blog 账号登录绑定页。
- 没有本地账号时先注册/登录 Z-Blog，再重新发起第三方登录。
- 邮箱相同也不会自动绑定，必须验证本地密码。
