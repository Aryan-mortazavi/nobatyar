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

/**
 * A real bcrypt hash (cost 12) of a value nobody can supply.
 *
 * Used only so that a sign-in attempt for an unknown address costs the same
 * as one for a known address. It is not a credential: the plaintext is a long
 * random string that exists nowhere in this repository.
 */
const TIMING_EQUALISER_HASH =
  "$2a$12$TfDemEOeVS92omaKpuluNOuxhipUepjHO7vrTlfqwFjdAMZYGOmHO";

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

  // Constant-ish response: never reveal whether the email exists.
  //
  // Skipping bcrypt when the user is absent made the two paths differ by the
  // cost of one hash (measured 838ms vs 1232ms), which is enough to enumerate
  // registered addresses by averaging. Always run one comparison — against a
  // throwaway hash when there is no account — so the timing does not leak.
  const passwordOk = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? TIMING_EQUALISER_HASH,
  );
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

  // A self-registered account is a CUSTOMER of the workspace, not a member of
  // its staff. It deliberately gets NO WorkspaceMember row, so the session
  // carries no workspace role and every staff screen and staff server action
  // refuses it. Previously this created a { role: "STAFF" } membership, which
  // gave any anonymous visitor the full dashboard: every customer's phone
  // number, the revenue figures and the settings form.
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

  await startSession({
    id: user.id,
    email: user.email,
    name: user.name,
    platformRole: user.platformRole,
    locale: user.locale,
  });

  await audit({
    action: "AUTH_REGISTER",
    actorUserId: user.id,
    actorEmail: user.email,
    meta: { ip },
  });

  // a customer has no business here; send them to their own appointments
  redirect(`/${locale}/my-appointments`);
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
