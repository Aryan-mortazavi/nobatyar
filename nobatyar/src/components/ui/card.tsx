import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-2xl border bg-card text-card-foreground", {
  variants: {
    tone: {
      default: "",
      muted: "bg-muted/50 border-transparent",
      glass: "glass border-white/10",
      outline: "bg-transparent",
      gradient:
        "border-transparent text-primary-foreground bg-[linear-gradient(135deg,var(--primary),oklch(0.62_0.19_320))]",
    },
    padding: {
      none: "p-0",
      sm: "p-4",
      md: "p-6",
      lg: "p-8",
    },
    hover: {
      none: "",
      lift: "transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-30px_color-mix(in_oklab,var(--primary)_60%,transparent)]",
      glow: "transition duration-300 hover:border-primary/40 hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_12%,transparent)]",
    },
  },
  defaultVariants: { tone: "default", padding: "md", hover: "none" },
});

export function Card({
  className,
  tone,
  padding,
  hover,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ tone, padding, hover }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2", className)} {...props} />;
}

export { cardVariants };
