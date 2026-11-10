"use client";

import { useEffect } from "react";

const GLASS_SELECTOR = [
  ".card",
  ".auth-card",
  ".stat",
  ".provider-card",
  ".role-card",
  ".modal",
].join(",");

/** 只给鼠标悬停的玻璃元素写入局部高光坐标，不在页面上铺一层静态反光。 */
export function GlassHover() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    let current: HTMLElement | null = null;
    let frame = 0;
    let latest: PointerEvent | null = null;

    function targetOf(event: PointerEvent): HTMLElement | null {
      const target = event.target as Element | null;
      return target?.closest?.(GLASS_SELECTOR) as HTMLElement | null;
    }

    function paint(event: PointerEvent) {
      const el = targetOf(event);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      el.style.setProperty("--glass-hx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
      el.style.setProperty("--glass-hy", `${((event.clientY - rect.top) / rect.height) * 100}%`);
      current = el;
    }

    function move(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      latest = event;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (latest) paint(latest);
      });
    }

    function out(event: PointerEvent) {
      const el = targetOf(event);
      if (!el || el !== current) return;
      const related = event.relatedTarget as Node | null;
      if (related && el.contains(related)) return;
      el.style.removeProperty("--glass-hx");
      el.style.removeProperty("--glass-hy");
      current = null;
    }

    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", out, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", out);
    };
  }, []);

  return null;
}
