/**
 * Toast Notification System — transient notifications for the TUI
 *
 * Provides a ToastProvider context and useToast hook for showing
 * auto-dismissing notifications with type-based styling.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { useTheme } from "../context/theme";
import type { Theme } from "../context/theme";
import type { RGBA } from "@opentui/core";

// ── Types ────────────────────────────────────────────

export type ToastType = "info" | "success" | "warning" | "error";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, duration?: number) => void;
}

// ── Icons & Colors ───────────────────────────────────

const TOAST_ICONS: Record<ToastType, string> = {
  info: "\u2139",     // i
  success: "\u2713",  // checkmark
  warning: "\u26A0",  // warning sign
  error: "\u2717",    // x mark
};

function getToastColor(type: ToastType, theme: Theme): RGBA {
  switch (type) {
    case "info":    return theme.info;
    case "success": return theme.success;
    case "warning": return theme.warning;
    case "error":   return theme.error;
  }
}

// ── Context ──────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const DEFAULT_DURATION = 3000;
const MAX_VISIBLE = 3;

// ── Provider ─────────────────────────────────────────

export function ToastProvider(props: { children: ReactNode }) {
  const { theme } = useTheme();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = ++idRef.current;
    const dur = duration ?? DEFAULT_DURATION;
    const item: ToastItem = { id, type, message, duration: dur };

    setToasts((prev) => {
      const next = [...prev, item];
      // Keep only the most recent MAX_VISIBLE toasts
      if (next.length > MAX_VISIBLE) {
        const removed = next.splice(0, next.length - MAX_VISIBLE);
        // Clean up timers for removed toasts
        for (const r of removed) {
          const timer = timersRef.current.get(r.id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(r.id);
          }
        }
      }
      return next;
    });

    // Set auto-dismiss timer
    const timer = setTimeout(() => {
      removeToast(id);
    }, dur);
    timersRef.current.set(id, timer);
  }, [removeToast]);

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {props.children}
      {/* Toast overlay — positioned at the bottom, above status bar */}
      {toasts.length > 0 && (
        <box flexDirection="column" alignItems="flex-end">
          {toasts.map((t) => {
            const color = getToastColor(t.type, theme);
            const icon = TOAST_ICONS[t.type];
            return (
              <box key={t.id} height={1} flexDirection="row" justifyContent="flex-end">
                <text fg={color}>{` ${icon} `}</text>
                <text fg={theme.text}>{t.message}</text>
                <text fg={theme.textDim}>{" "}</text>
              </box>
            );
          })}
        </box>
      )}
    </ToastContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
