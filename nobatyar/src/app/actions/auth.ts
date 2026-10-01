"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { prisma } from "@/lib/db";
import {
  audit,
  endSession,
  getSession,
  hashPassword,
  startSession,
  verifyPassword,
} from "@/lib/auth";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { fieldErrors, loginSchema, registerSchema } from "@/lib/validators";
import type { Locale } from "@/lib/i18n";

export type FormState =
  | { ok: true }
  | { ok: false; error: string; fields?: Record<string, string> };

async function requestIp(): Promise<string> {
  const store = await headers();
  return (
    store.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    store.get("x-real-ip") ??
    "local"
  );
}

function safeNext(value: unknown, locale: Locale): string {
  const raw = typeof value === "string" ? value : "";
  // only same-origin relative paths → no open redirect
  return raw.startsWith(`/${locale}`) && !raw.startsWith("//") ? raw : `/${locale}/dashboard`;
}

export async function loginAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = ((formData.get("locale") as Locale) ?? "fa") satisfies Locale;
  const ip = await requestIp();

  const limited = rateLimit(`login:${ip}`, 8, 5 * 60_000);
  if (!limited.ok) return { ok: false, error: "RATE_LIMITED" };

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { memberships: { orderBy: { createdAt: "asc" } } },
  });

  // constant-ish response: never reveal whether the email exists
  const passwordOk = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !passwordOk || !user.isActive) {
    await audit({
      action: "AUTH_LOGIN_FAILED",
      actorEmail: parsed.data.email,
      meta: { ip },
    });
    return { ok: false, error: "BAD_CREDENTIALS" };
  }

  resetRateLimit(`login:${ip}`);
  const membership = user.memberships[0] ?? null;
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await startSession(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      locale: user.locale,
    },
    membership ? { workspaceId: membership.workspaceId, role: membership.role } : null,
  );
  await audit({
    action: "AUTH_LOGIN",
    actorUserId: user.id,
    actorEmail: user.email,
    meta: { ip, role: membership?.role ?? null },
  });

  redirect(safeNext(formData.get("next"), locale));
}

export async function registerAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = ((formData.get("locale") as Locale) ?? "fa") satisfies Locale;
  const ip = await requestIp();

  const limited = rateLimit(`register:${ip}`, 5, 30 * 60_000);
  if (!limited.ok) return { ok: false, error: "RATE_LIMITED" };

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    locale,
  });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: "EMAIL_TAKEN", fields: { email: "EMAIL_TAKEN" } };

  // a brand-new account joins the demo workspace as a customer-facing user
  const workspace = await prisma.workspace.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      passwordHash: await hashPassword(parsed.data.password),
      platformRole: "CUSTOMER",
      locale: parsed.data.locale,
    },
  });

  await startSession(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      locale: user.locale,
    },
    workspace ? { workspaceId: workspace.id, role: "STAFF" } : null,
  );

  await audit({
    action: "AUTH_REGISTER",
    actorUserId: user.id,
    actorEmail: user.email,
    meta: { ip },
  });

  redirect(`/${locale}/dashboard`);
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  await audit({
    action: "AUTH_LOGOUT",
    actorUserId: session?.sub ?? null,
    actorEmail: session?.email ?? null,
  });
  await endSession();
  redirect("/");
}
