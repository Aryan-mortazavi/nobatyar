"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Accessible dialog built on the native <dialog> element: focus trapping,
 * Escape-to-close and the top layer come from the platform, not from us.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    node.addEventListener("cancel", onCancel);
    return () => node.removeEventListener("cancel", onCancel);
  }, [onClose]);

  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl" }[size];

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={ref}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm",
        "open:animate-fade-up",
        width,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X aria-hidden />
        </Button>
      </div>
      {children ? <div className="p-5">{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 p-4">
          {footer}
        </div>
      ) : null}
    </dialog>,
    document.body,
  );
}

/** Lightweight tab bar (no external dependency, keyboard accessible). */
export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: string; label: React.ReactNode; count?: number }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted/50 p-1",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className="rounded-md bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
