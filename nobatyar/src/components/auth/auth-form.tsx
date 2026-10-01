"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle } from "lucide-react";

import { loginAction, registerAction, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/i18n";

const ERROR_KEYS: Record<string, keyof Dictionary["errors"]> = {
  BAD_CREDENTIALS: "badCredentials",
  EMAIL_TAKEN: "emailTaken",
  RATE_LIMITED: "rateLimited",
  VALIDATION: "validation",
  INVALID: "validation",
};

export function AuthForm({
  mode,
  locale,
  t,
  next,
  demo,
}: {
  mode: "login" | "register";
  locale: Locale;
  t: Dictionary;
  next?: string;
  demo?: { email: string; password: string };
}) {
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction, pending] = useActionState<FormState | null, FormData>(
    action,
    null,
  );

  const errorKey = state && !state.ok ? ERROR_KEYS[state.error] : undefined;
  const errorText = errorKey ? t.errors[errorKey] : null;

  return (
    <Card padding="lg" className="w-full max-w-md">
      <div className="mb-6 space-y-1.5">
        <h1 className="text-xl font-bold tracking-tight">
          {mode === "login" ? t.auth.loginTitle : t.auth.registerTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "login" ? t.auth.loginSubtitle : t.auth.registerSubtitle}
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {next ? <input type="hidden" name="next" value={next} /> : null}

        {mode === "register" ? (
          <Field label={t.auth.fullName} required htmlFor="name">
            <Input id="name" name="name" required minLength={2} maxLength={80} autoComplete="name" />
          </Field>
        ) : null}

        <Field
          label={t.auth.email}
          required
          htmlFor="email"
          error={state && !state.ok ? state.fields?.email : undefined}
        >
          <Input id="email" name="email" type="email" required autoComplete="email" dir="ltr" />
        </Field>

        {mode === "register" ? (
          <Field label={t.common.phone} htmlFor="phone">
            <Input id="phone" name="phone" minLength={8} maxLength={24} autoComplete="tel" dir="ltr" />
          </Field>
        ) : null}

        <Field
          label={t.auth.password}
          required
          htmlFor="password"
          error={state && !state.ok ? state.fields?.password : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            dir="ltr"
          />
        </Field>

        {mode === "register" ? (
          <>
            <Field
              label={t.auth.confirmPassword}
              required
              htmlFor="confirmPassword"
              error={state && !state.ok ? state.fields?.confirmPassword : undefined}
            >
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                dir="ltr"
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              {locale === "fa"
                ? "حداقل ۸ کاراکتر شامل حرف و رقم."
                : "At least 8 characters including a letter and a digit."}
            </p>
          </>
        ) : null}

        {errorText ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {errorText}
          </p>
        ) : null}

        <Button type="submit" block loading={pending}>
          {pending
            ? t.common.loading
            : mode === "login"
              ? t.auth.login
              : t.auth.register}
        </Button>
      </form>

      {demo ? (
        <div className="mt-6 rounded-xl border border-dashed border-border bg-muted/40 p-4">
          <p className="text-xs font-semibold">{t.auth.demoTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.auth.demoBody}</p>
          <p className="mt-2 font-mono text-[11px] text-foreground/80" dir="ltr">
            {demo.email} / {demo.password}
          </p>
          <DemoFill
            email={demo.email}
            password={demo.password}
            label={t.auth.login}
          />
        </div>
      ) : null}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "login" ? t.auth.noAccount : t.auth.hasAccount}{" "}
        <a
          href={mode === "login" ? `/${locale}/register` : `/${locale}/login`}
          className="font-medium text-primary hover:underline"
        >
          {mode === "login" ? t.auth.register : t.auth.login}
        </a>
      </p>
    </Card>
  );
}

function DemoFill({
  email,
  password,
  label,
}: {
  email: string;
  password: string;
  label: string;
}) {
  const [value, setValue] = React.useState({ email, password });
  return (
    <form
      className="mt-3 flex items-center gap-2"
      action="?"
      onSubmit={(event) => event.preventDefault()}
    >
      <input
        aria-label="demo email"
        className="h-8 w-full rounded-lg border border-input bg-background px-2 font-mono text-[11px]"
        value={value.email}
        onChange={(event) => setValue((v) => ({ ...v, email: event.target.value }))}
      />
      <input
        aria-label="demo password"
        className="h-8 w-full rounded-lg border border-input bg-background px-2 font-mono text-[11px]"
        value={value.password}
        onChange={(event) => setValue((v) => ({ ...v, password: event.target.value }))}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          const emailInput = document.getElementById("email") as HTMLInputElement | null;
          const passwordInput = document.getElementById("password") as HTMLInputElement | null;
          if (emailInput) {
            emailInput.value = value.email;
            emailInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
          if (passwordInput) {
            passwordInput.value = value.password;
            passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }}
      >
        {label}
      </Button>
    </form>
  );
}
