"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info" | "warning";
type Toast = { id: number; title: string; description?: string; tone: ToastTone };

const ToastContext = React.createContext<{
  push: (toast: Omit<Toast, "id">) => void;
} | null>(null);

const ICONS: Record<ToastTone, React.ElementType> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: TriangleAlert,
};

const TONES: Record<ToastTone, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-info",
  warning: "text-warning",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const counter = React.useRef(0);

  const remove = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback(
    (toast: Omit<Toast, "id">) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current, { ...toast, id }]);
      window.setTimeout(() => remove(id), 6000);
    },
    [remove],
  );

  const value = React.useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-100 flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6">
              {toasts.map((toast) => {
                const Icon = ICONS[toast.tone];
                return (
                  <div
                    key={toast.id}
                    role="status"
                    className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur animate-fade-up"
                  >
                    <Icon className={cn("mt-0.5 size-5 shrink-0", TONES[toast.tone])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{toast.title}</p>
                      {toast.description ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{toast.description}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(toast.id)}
                      className="text-muted-foreground transition hover:text-foreground"
                      aria-label="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context.push;
}
