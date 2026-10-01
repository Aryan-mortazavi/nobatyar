/**
 * Session token helpers (Edge-safe).
 *
 * This module is imported by the middleware, so it must stay free of Node
 * built-ins, `server-only` and the Prisma client.
 */
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "ny_session";
export const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

export type SessionPayload = {
  sub: string; // user id
  email: string;
  name: string;
  role: string; // platform role
  wid: string; // active workspace id
  wrole: string; // OWNER | ADMIN | MANAGER | STAFF
  locale: string;
};

function secretKey(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET is missing or too short (min. 32 characters)");
  }
  return new TextEncoder().encode(value);
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("nobatyar")
    .setAudience("nobatyar-web")
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "nobatyar",
      audience: "nobatyar-web",
    });
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: String(payload.role ?? "CUSTOMER"),
      wid: String(payload.wid ?? ""),
      wrole: String(payload.wrole ?? "STAFF"),
      locale: String(payload.locale ?? "fa"),
    };
  } catch {
    return null;
  }
}
