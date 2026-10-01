import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      tone: {
        default: "border-border bg-muted text-muted-foreground",
        primary: "border-primary/25 bg-primary/10 text-primary",
        success: "border-success/25 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/15 text-warning",
        danger: "border-danger/25 bg-danger/10 text-danger",
        info: "border-info/25 bg-info/12 text-info",
        outline: "border-border bg-transparent text-foreground/80",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn("size-1.5 rounded-full bg-current", className)} aria-hidden />;
}

export function Separator({
  className,
  orientation = "horizontal",
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div
      role="separator"
      className={cn(
        "bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} aria-hidden />;
}

export function Progress({
  value,
  max = 100,
  className,
  tone = "primary",
}: {
  value: number;
  max?: number;
  className?: string;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const color = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Small helper for the "×" affordance on dismissible banners. */
export function CloseButton({
  onClick,
  className,
  label = "Close",
}: {
  onClick: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <X className="size-4" aria-hidden />
    </button>
  );
}
