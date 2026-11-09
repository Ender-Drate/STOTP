# AI Review #89 整改记录

对应 Issue: [#89](https://github.com/EnderCraft-Server/STOTP/issues/89)

| 项 | 状态 | 整改 |
| --- | --- | --- |
| 改邮箱无再认证 | 已修复 | 修改邮箱要求当前密码 + 已启用 TOTP 时的动态码；成功后撤销全部会话/令牌/重置链接，旧邮箱通知 + 新邮箱验证 |
| audit 无索引/不清理 | 已修复 | 增加 `(ip,ts)`、`(event,ts)`、`(event,ip,ts)`、`(ts)` 索引；按 `audit_retention_days` 清理 audit 和 risk_observations |
| `/api/risk/observe` 放大写入 | 已修复 | 4KB 流式上限、未登录 5 次/分钟、全局 120 次/分钟；移除每请求全表 DELETE，改为每日清理 |
| Provider secret 明文 | 已修复 | client_secret 使用 AES-256-GCM 加密；启动迁移旧明文；providerView 不返回 secret |
| Provider URL SSRF | 已修复 | 生产只允许 https；拒绝 localhost/私网/保留地址及解析到私网的域名；token/userinfo 禁止跟随重定向 |
| Host 伪造同源 | 已修复 | 同源校验只接受 `PUBLIC_URL` 和 `AUTH_ALLOWED_ORIGINS`，不再信任 Host |
| login_failures 不清理 | 已修复 | 每日清理超过 24h 的失败计数和过期限速桶 |
| CSP unsafe-inline | 已修复 | Middleware 每请求生成 nonce；Next 内联脚本携带 nonce；nginx 示例不再重复下发 CSP |
| openid-configuration 404 | 已修复 | 增加显式 `.well-known/openid-configuration` route，移除不可靠的 rewrite |
| HSTS/Referrer 重复 | 已修复 | Next 下发 HSTS includeSubDomains；nginx 示例移除重复 CSP/Referrer 等头 |

## 兼容性/边界

- `AUTH_ALLOWED_ORIGINS` 必须显式配置反代别名，不能再靠伪造 Host。
- 修改邮箱会强制退出全部会话。
- Provider 地址会做 DNS 解析检查，但没有完全消除 DNS rebinding；生产建议只配置可信 provider 域名。
- nginx 如果仍保留旧 CSP/Referrer 头，会与 Next 的 nonce CSP 冲突，需要删除同名头。

## 验证

```text
npm run build
npm run e2e:security
npm run e2e:profile-email
npm run e2e:provider
npm run e2e
npm run e2e:totp
npm run e2e:password-reset
npm run e2e:ip-risk-clear
```

- `e2e:security` 覆盖 nonce CSP、发现文档、audit 索引、Host 伪造、4KB observe 上限。
- `e2e:profile-email` 覆盖无密码改邮箱 400、正确改邮箱后旧会话失效。
- `e2e:provider` 覆盖 client_secret 密文落库。
