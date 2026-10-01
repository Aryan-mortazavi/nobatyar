import * as React from "react";

import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-xl border border-input bg-background/60 px-3.5 text-sm text-foreground " +
  "placeholder:text-muted-foreground/70 transition " +
  "focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/12 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ className, invalid, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    aria-invalid={invalid || undefined}
    className={cn(fieldBase, "h-11", invalid && "border-danger/60 focus:ring-danger/15", className)}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, rows = 4, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    aria-invalid={invalid || undefined}
    className={cn(fieldBase, "py-2.5 leading-relaxed", invalid && "border-danger/60", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "h-11 appearance-none pe-9", className)}
      {...props}
    >
      {children}
    </select>
    <svg
      className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
    >
      <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </div>
));
Select.displayName = "Select";

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-foreground/90", className)}
      {...props}
    >
      {children}
      {required ? <span className="ms-1 text-danger">*</span> : null}
    </label>
  );
}

/** Label + control + hint/error, the standard form unit. */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  id,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-primary" : "bg-muted",
        disabled && "opacity-50",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block size-4.5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5.5" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  className,
  id,
  name,
  value,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  className?: string;
  id?: string;
  /** posts the checked state with the surrounding <form> */
  name?: string;
  value?: string;
  ariaLabel?: string;
}) {
  return (
    <>
      {/* the visual control is a button; this hidden input carries the form value */}
      {name ? (
        <input type="hidden" name={name} value={checked ? (value ?? "true") : ""} />
      ) : null}
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={ariaLabel}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "grid size-5 place-items-center rounded-md border transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
          className,
        )}
      >
        {checked ? (
          <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden>
            <path
              d="m5 10.5 3.2 3.2L15 7"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
    </>
  );
}
