import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

import { prisma } from "./db";
import { env } from "./env";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session-token";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export type Session = SessionPayload & { isAuthenticated: true };

/** The signed session of the current request (memoised per request). */
export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  return payload ? { ...payload, isAuthenticated: true } : null;
});

export async function startSession(user: {
  id: string;
  email: string;
  name: string;
  platformRole: string;
  locale: string;
}, membership?: { workspaceId: string; role: string } | null): Promise<void> {
  const token = await signSessionToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.platformRole,
    wid: membership?.workspaceId ?? "",
    wrole: membership?.role ?? "STAFF",
    locale: user.locale,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

const STAFF_ROLES = ["OWNER", "ADMIN", "MANAGER", "STAFF"];

/** Server-component guard: no session → redirect to the login page. */
export async function requireSession(
  locale: string,
  roles: string[] = STAFF_ROLES,
): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/dashboard`)}`);
  }
  if (roles.length > 0 && !roles.includes(session.wrole)) {
    redirect(`/${locale}`);
  }
  return session;
}

/** The workspace a request operates on (single-tenant UX, multi-tenant model). */
export const getActiveWorkspace = cache(async () => {
  const session = await getSession();
  const workspaceId = session?.wid;
  const workspace = workspaceId
    ? await prisma.workspace.findUnique({ where: { id: workspaceId } })
    : await prisma.workspace.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (!workspace) throw new Error("No workspace configured — run `npm run db:seed`.");
  return workspace;
});

export async function requireWorkspace(locale: string, roles?: string[]) {
  const session = await requireSession(locale, roles);
  const workspace = await getActiveWorkspace();
  return { session, workspace };
}

export function canManage(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Best-effort client IP for the audit trail. */
export async function clientIp(): Promise<string | null> {
  const store = await headers();
  return store.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** Immutable security record: who did what, when and from where. */
export async function audit(params: {
  action: string;
  workspaceId?: string | null;
  entity?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
  actorEmail?: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: params.action,
        workspaceId: params.workspaceId ?? null,
        entity: params.entity ?? null,
        entityId: params.entityId ?? null,
        meta: params.meta ? JSON.stringify(params.meta) : null,
        actorEmail: params.actorEmail ?? null,
        actorUserId: params.actorUserId ?? null,
        ip: await clientIp(),
      },
    });
  } catch {
    // Auditing must never break the request it describes.
  }
}

export const appEnv = env;
