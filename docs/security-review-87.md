# AI Review #87 整改记录

对应 Issue: [#87](https://github.com/Ender-Drate/STOTP/issues/87)

| 编号 | 状态 | 整改 |
| --- | --- | --- |
| 1 | 已修复 | `login:ip:{ip}` 全局桶 30 次/5 分钟；同一 IP 命中 2 个不同账号失败后要求验证码 |
| 2 | 已修复 | 请求链路 scrypt 改为异步 `promisify(scrypt)`；同步版本只保留启动初始化管理员 |
| 3 | 已修复 | `exp` 缺失/非数字直接无效；校验 `nbf` 与 `iat` 时钟偏移 |
| 4 | 已修复 | 授权码改为 `UPDATE ... WHERE used=0` 并检查 `changes === 1` |
| 5 | 已修复 | refresh 条件轮换；旧 refresh 重放时撤销该 user+client 全部 token |
| 6 | 已修复 | TOTP 使用 `timingSafeEqual`；`totp_used(user_id, timestep)` 防同窗口重放 |
| 7 | 已修复 | `users.totp_secret` 使用 AES-256-GCM 加密，启动时迁移旧明文 |
| 8 | 已修复 | README 明确 `AUTH_TRUST_PROXY=0` 时没有真实 IP 维度限速 |
| 9 | 已修复 | 启动清理 + 每日清理过期 auth_codes/tokens/sessions/challenges 等 |
| 10 | 已修复 | `users.uuid` 作为 OIDC `sub`；userinfo 兼容旧数字 sub |
| 11 | 已修复 | id_token 增加 `azp`、`at_hash`；公共客户端强制 `state` |
| 12 | 已修复 | `.github/workflows/ci.yml` 跑 build + e2e:security + e2e:rbac + e2e |
| 13 | 已修复 | passkey options POST 增加 `assertSameOrigin` |

## 兼容性说明

- 现有用户的 OIDC `sub` 从数字 id 改为 UUID，依赖旧 sub 的下游绑定需要迁移；
  userinfo 仍兼容旧数字 sub 的访问令牌。
- 公共 OAuth 客户端现在必须带 `state`。
- 旧明文 TOTP secret 会在服务启动时原地加密；备份恢复时需使用同一个 `AUTH_CONFIG_SECRET`
  或同一份 `data/config-secret`，否则无法解密。

## 验证

```text
npm run build
npm run e2e
npm run e2e:security
npm run e2e:totp
npm run e2e:provider
npm run e2e:rbac
npm run e2e:captcha
npm run e2e:encrypted
npm run e2e:risk
npm run e2e:sessions
npm run e2e:user-delete
npm run e2e:password-reset
npm run e2e:ip-risk-clear
```

另用非 `AUTH_E2E` 实例验证：同一 `X-Real-IP` 连续失败两个账号后，第三个正确密码登录也返回
`captcha_required`。
