# STOTP 服务端

> Python 3.11+ 实现，提供 OAuth2 授权服务器与 STOTP 验证 API。
> 实现进度见仓库 Issue #2；接口契约见 [`../docs/api.md`](../docs/api.md)，密码学细节见
> [`../docs/crypto-protocol.md`](../docs/crypto-protocol.md)。

## 计划中的目录

```
server/
├── stotp/
│   ├── __main__.py      # CLI：--host --port --db --dev-login
│   ├── config.py        # 环境变量与启动校验
│   ├── crypto.py        # HKDF / AES-GCM / TOTP / UUID / JWT
│   ├── store.py         # SQLite（WAL）+ 种子信封加密
│   ├── oauth.py         # /oauth/* 与发现文档
│   ├── api.py           # /v1/* 注册、轮换、验证
│   ├── http.py          # 路由、请求解析、统一错误
│   └── ratelimit.py     # 令牌桶 + 失败锁定
├── tests/               # unittest 自检
├── requirements.txt
└── README.md
```

## 安全基线

- 验证接口恒 `200`、定长响应、恒定耗时预算、限速与重放缓存。
- seed 以 AES-256-GCM 信封加密落库，主密钥来自环境变量或 `master.key`。
- 生产模式禁用内置 dev 登录页，TLS 由反向代理终止。
