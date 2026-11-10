"use client";

import { useEffect, useRef, useState } from "react";
import { hasTranslation, translateText } from "@/lib/ui-i18n";

type ThemePref = "system" | "light" | "dark";
type Lang = "zh" | "en";

const THEME_KEY = "stotp-theme";
const LANG_KEY = "stotp-lang";
const SKIP = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"]);

function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(pref: ThemePref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

export function PreferencesDock() {
  const [theme, setTheme] = useState<ThemePref>("system");
  const [lang, setLang] = useState<Lang>("zh");
  const translatedNodes = useRef(new Set<Node>());
  const originals = useRef(new WeakMap<Node, string>());
  const attrOriginals = useRef(new WeakMap<Element, Record<string, string>>());
  const attrNodes = useRef(new Set<Element>());
  const observer = useRef<MutationObserver | null>(null);
  const applying = useRef(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY) as ThemePref | null;
    const nextTheme = savedTheme === "light" || savedTheme === "dark" || savedTheme === "system"
      ? savedTheme : "system";
    const savedLang = localStorage.getItem(LANG_KEY) as Lang | null;
    const nextLang = savedLang === "zh" || savedLang === "en"
      ? savedLang
      : (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");
    setTheme(nextTheme);
    setLang(nextLang);
    applyTheme(nextTheme);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem(THEME_KEY) as ThemePref | null) === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = lang === "zh" ? "STOTP 账户" : "STOTP Account";

    function ignored(node: Node): boolean {
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
      if (!el) return true;
      if (el.closest("[data-no-i18n]")) return true;
      return Boolean(el.closest("script,style,code,pre,textarea") || SKIP.has(el.tagName));
    }

    function translateElementAttributes(el: Element) {
      if (el.closest("[data-no-i18n]")) return;
      const attrs = ["placeholder", "title", "aria-label", "alt"];
      let saved = attrOriginals.current.get(el);
      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (!value || !hasTranslation(value.trim())) continue;
        if (!saved) {
          saved = {};
          attrOriginals.current.set(el, saved);
          attrNodes.current.add(el);
        }
        if (!(attr in saved)) saved[attr] = value;
        el.setAttribute(attr, translateText(value.trim()));
      }
    }

    function translateNode(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (ignored(node)) return;
        const raw = node.nodeValue || "";
        const match = raw.match(/^(\s*)(.*?)(\s*)$/s);
        if (!match) return;
        const core = match[2];
        if (!core || !hasTranslation(core)) return;
        const translated = translateText(core);
        if (translated === core) return;
        if (!originals.current.has(node)) originals.current.set(node, raw);
        translatedNodes.current.add(node);
        node.nodeValue = `${match[1]}${translated}${match[3]}`;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      if (ignored(el)) return;
      translateElementAttributes(el);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let current = walker.nextNode();
      while (current) {
        translateNode(current);
        current = walker.nextNode();
      }
    }

    function translateAll() {
      if (lang !== "en") return;
      applying.current = true;
      try {
        translateNode(document.body);
        document.title = document.title.includes("STOTP")
          ? "STOTP Account" : document.title;
      } finally {
        applying.current = false;
      }
    }

    function restoreAll() {
      applying.current = true;
      try {
        for (const node of translatedNodes.current) {
          const original = originals.current.get(node);
          if (original !== undefined && node.isConnected) node.nodeValue = original;
        }
        translatedNodes.current.clear();
        for (const el of attrNodes.current) {
          const saved = attrOriginals.current.get(el);
          if (!saved || !el.isConnected) continue;
          for (const [attr, value] of Object.entries(saved)) el.setAttribute(attr, value);
        }
        attrNodes.current.clear();
        attrOriginals.current = new WeakMap();
      } finally {
        applying.current = false;
      }
    }

    if (lang === "en") {
      translateAll();
      observer.current?.disconnect();
      observer.current = new MutationObserver((mutations) => {
        if (applying.current) return;
        for (const mutation of mutations) {
          if (mutation.type === "characterData" && mutation.target.isConnected) {
            translateNode(mutation.target);
          }
          for (const node of mutation.addedNodes) translateNode(node);
        }
      });
      observer.current.observe(document.body, {
        childList: true, subtree: true, characterData: true,
      });
    } else {
      observer.current?.disconnect();
      observer.current = null;
      restoreAll();
    }
    return () => {
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [lang]);

  function cycleTheme() {
    const next: ThemePref = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  function toggleLang() {
    const next: Lang = lang === "zh" ? "en" : "zh";
    setLang(next);
    localStorage.setItem(LANG_KEY, next);
  }

  const themeLabel = theme === "system"
    ? (lang === "zh" ? "自动" : "Auto")
    : theme === "light"
      ? (lang === "zh" ? "浅色" : "Light")
      : (lang === "zh" ? "深色" : "Dark");
  const themeTitle = theme === "system"
    ? (lang === "zh" ? "跟随系统" : "Follow system")
    : theme === "light"
      ? (lang === "zh" ? "浅色" : "Light")
      : (lang === "zh" ? "深色" : "Dark");

  return (
    <div className="pref-dock" data-no-i18n>
      <button
        type="button"
        className="pref-btn"
        onClick={cycleTheme}
        title={themeTitle}
        aria-label={`Theme: ${theme}`}
      >
        {theme === "system" ? (
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : theme === "light" ? (
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M20 15.3A8.5 8.5 0 0 1 8.7 4a8.5 8.5 0 1 0 11.3 11.3Z"
              fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        )}
        <span>{themeLabel}</span>
      </button>
      <span className="pref-divider" aria-hidden="true" />
      <button type="button" className="pref-btn pref-lang" onClick={toggleLang}
        title={lang === "zh" ? "Switch to English" : "Switch to Chinese"}
        aria-label={lang === "zh" ? "Switch to English" : "Switch to Chinese"}>
        {lang === "zh" ? "EN" : "ZH"}
      </button>
    </div>
  );
}
