import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium " +
    "transition-[background-color,color,box-shadow,transform] duration-200 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 " +
    "[&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[0_10px_30px_-12px_var(--primary)] hover:brightness-110",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline: "border border-border bg-card hover:border-primary/50 hover:bg-accent/60",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        danger: "bg-danger text-danger-foreground hover:brightness-110",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3.5 text-sm [&_svg]:size-4",
        md: "h-11 px-5 text-sm [&_svg]:size-4",
        lg: "h-13 px-7 text-base [&_svg]:size-5",
        icon: "size-10 [&_svg]:size-4.5",
        "icon-sm": "size-9 [&_svg]:size-4",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
  };

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  loading = false,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const content = (
    <>
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {children}
    </>
  );

  if (asChild) {
    // Radix's Slot accepts exactly one child, so icon + label are wrapped.
    return (
      <Slot className={cn(buttonVariants({ variant, size, block }), className)} {...props}>
        <span className="inline-flex items-center justify-center gap-2">{content}</span>
      </Slot>
    );
  }

  return (
    <button
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {content}
    </button>
  );
}

export { buttonVariants };
