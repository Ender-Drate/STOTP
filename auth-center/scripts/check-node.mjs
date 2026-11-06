const raw = process.versions.node;
const [major, minor] = raw.split(".").map(Number);
const ok = major > 22 || (major === 22 && minor >= 13);
if (!ok) {
  console.error(
    [
      "",
      `[auth-center] 需要 Node >= 22.13（推荐 24 LTS），当前是 ${raw}。`,
      "本项目使用 Node 内置的 node:sqlite；旧版本没有该模块，",
      "会在 Next.js 显示 Ready 之后、请求页面时才报 ERR_UNKNOWN_BUILTIN_MODULE。",
      "",
      "升级示例：",
      "  nvm install 24 && nvm use 24",
      "  或 https://github.com/nodesource/distributions",
      "",
    ].join("\n")
  );
  process.exit(1);
}
