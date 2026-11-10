# 液态玻璃界面

分支：`feat/liquid-glass-ui`（draft）

## 偏好

- 右下角浮动控制：
  - **主题**：自动 → 浅色 → 深色；默认跟随系统
  - **语言**：中文 / English；默认跟随浏览器语言
- 偏好保存在 `localStorage`：
  - `stotp-theme`
  - `stotp-lang`
- 首屏主题由 `app/layout.tsx` 的内联 nonce 脚本在绘制前写入，避免暗色闪白。

## 视觉层

- 新增 `app/liquid-glass.css`，只覆盖现有 class，不改业务组件结构。
- 中性蓝灰 ambient mesh，不使用高饱和彩虹渐变。
- 玻璃层采用半透明 tint + `backdrop-filter` + rim/specular 高光。
- 圆角：卡片 30px、登录卡 38px、输入 17px。
- 暗色为中性深蓝黑玻璃，不是简单反色。
- 支持 `prefers-reduced-motion` / `prefers-reduced-transparency` 降级。

## 语言层

- `lib/ui-i18n.ts` 保存中文 → 英文 UI 词条和少量组合规则。
- `PreferencesDock` 在客户端翻译文本节点、placeholder/title/aria-label，
  并用 MutationObserver 处理客户端导航后的新 DOM。
- 切换回中文时恢复原文本；OAuth/API 错误等动态长文本仍可能保留中文，
  后续可迁移到服务端 locale + 完整词典。

## 验证

```text
npm run build
```

预览截图在 `.tmp/lg-*.png`、`.tmp/theme-*.png`。
