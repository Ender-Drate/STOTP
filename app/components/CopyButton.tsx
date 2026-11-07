"use client";

import { useState } from "react";

export function CopyButton({ value, label = "复制" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          window.prompt("复制此内容", value);
        }
      }}
    >
      {done ? "已复制" : label}
    </button>
  );
}
