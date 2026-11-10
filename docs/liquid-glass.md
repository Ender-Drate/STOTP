# 液态玻璃界面

分支：`ux/apple-glass-refine`

## 偏好

- 右下角浮动控制：
  - **主题**：自动 → 浅色 → 深色；默认跟随系统
  - **语言**：中文 / English；默认跟随浏览器语言
- 移动端浮动控制收成图标并居中，避免遮挡右侧操作按钮
- 偏好保存在 `localStorage`：
  - `stotp-theme`
  - `stotp-lang`
- 首屏主题由 `app/layout.tsx` 的内联 nonce 脚本在绘制前写入，避免暗色闪白

## 视觉层

Apple 材质分层，不再把所有区域都做成高反光玻璃：

- 玻璃主要用于侧栏、文档侧栏、浮层、登录卡和偏好胶囊
- 内容卡片降低透明度，使用 hairline 边框和很轻的阴影
- 不再使用 pointer-following 高光/静态斜向反光
- 控件改回系统尺寸：
  - 卡片 20px
  - 登录卡 26px
  - 输入/按钮 8px
  - 小按钮 7px
- 侧栏选中项改为淡蓝色 tint，不使用整块高饱和蓝
- 中性蓝灰背景，移除彩虹/紫粉渐变
- 暗色为炭黑玻璃，不是简单反色
- 支持 `prefers-reduced-motion` / `prefers-reduced-transparency` 降级

## 页面控件

- 登录页：provider 区域收紧为 34px 列表行，图标失败时显示中性字母占位
- CSP 编辑器：指令来源改为 1 行 34px 可拉伸输入，不再铺满大块空白
- 表格、文档、设置、应用列表统一控件高度和圆角
- 移动端侧栏改为顶部材质条，偏好胶囊居中

## 语言层

- `lib/ui-i18n.ts` 保存中文 → 英文 UI 词条和少量组合规则。
- `PreferencesDock` 在客户端翻译文本节点、placeholder/title/aria-label，
  并用 MutationObserver 处理客户端导航后的新 DOM。
- 切换回中文时恢复原文本；OAuth/API 错误等动态长文本仍可能保留中文，
  后续可迁移到服务端 locale + 完整词典。

## 验证

```text
npm run build
npm run e2e:security
npm run e2e:profile-email
npm run e2e:totp
npm run e2e
```

预览截图在 `.tmp/apple-*.png`、`.tmp/lg-mobile-*.png`。
