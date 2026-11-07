"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ToastKind = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastApi {
  push: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev, { id, kind, title, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const api: ToastApi = {
    push,
    success: (title, message) => push("success", title, message),
    error: (title, message) => push("error", title, message),
    warning: (title, message) => push("warning", title, message),
    info: (title, message) => push("info", title, message),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div className={`toast toast-${item.kind}`} key={item.id} role="status">
            <div className="toast-dot" />
            <div>
              <div className="toast-title">{item.title}</div>
              {item.message ? <div className="toast-message">{item.message}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    };
  }
  return ctx;
}

export function Alert({
  kind = "info", title, children, onClose,
}: {
  kind?: ToastKind;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`alert alert-${kind}`} role="alert">
      <div className="alert-dot" />
      <div style={{ flex: 1 }}>
        {title ? <div className="alert-title">{title}</div> : null}
        <div className="alert-body">{children}</div>
      </div>
      {onClose ? (
        <button type="button" className="alert-close" onClick={onClose} aria-label="关闭">×</button>
      ) : null}
    </div>
  );
}

export function Notification({
  kind = "info", title, children, onClose,
}: {
  kind?: ToastKind;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`notification notification-${kind}`} role="status">
      <div className="notification-dot" />
      <div style={{ flex: 1 }}>
        {title ? <div className="notification-title">{title}</div> : null}
        <div className="notification-body">{children}</div>
      </div>
      {onClose ? (
        <button type="button" className="alert-close" onClick={onClose} aria-label="关闭">×</button>
      ) : null}
    </div>
  );
}

export function Modal({
  open, title, children, footer, onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="card-title">{title}</div>
          <button type="button" className="alert-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Popover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(230, window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      setCoords({ top: Math.min(rect.bottom + 7, window.innerHeight - 150), left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <span className="popover-wrap" ref={triggerRef}>
      <button type="button" className="popover-trigger" onClick={() => setOpen((value) => !value)}>
        {label}
      </button>
      {open && coords && typeof document !== "undefined" ? createPortal(
        <div className="popover" role="dialog" style={{ position: "fixed", top: coords.top, left: coords.left, right: "auto" }}>
          {children}
          <button type="button" className="popover-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
        </div>,
        document.body
      ) : null}
    </span>
  );
}
