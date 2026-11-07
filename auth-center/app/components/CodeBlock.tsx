"use client";

import { useState } from "react";

export function CodeBlock({ code, label = "HTTP" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{label}</span>
        <button type="button" onClick={copy}>{copied ? "已复制" : "复制"}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}
