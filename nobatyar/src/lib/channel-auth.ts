/**
 * Channel API authentication.
 *
 * A "channel" is any front door onto the web app that is not a browser: today
 * the Telegram bot, tomorrow WhatsApp or a call centre. Channels are trusted
 * integrations, not end users, so they authenticate with a shared secret
 * (`CHANNEL_API_SECRET`); the *customer* behind the channel then proves who
 * they are with a short-lived signed token issued by `identifyCustomer`.
 *
 * Two credentials, never one:
 *   Authorization: Bearer <CHANNEL_API_SECRET>   "I am a channel"
 *   X-Customer-Token: <jwt>                      "…and this is the customer"
 *
 * Possessing one without the other is useless, so a leaked customer token is
 * not enough to read or cancel anybody's appointments.
 */
import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";

const CUSTOMER_AUDIENCE = "nobatyar-channel";
const CUSTOMER_TOKEN_DAYS = 90;

export type ChannelPrincipal = {
  /** which integration is calling: telegram | whatsapp | … */
  channel: string;
};

export type CustomerPrincipal = {
  userId: string;
  telegramId: string | null;
  workspaceId: string;
  locale: string;
};

function secretKey(): Uint8Array | null {
  const secret = process.env.CHANNEL_API_SECRET;
  if (!secret || secret.length < 24) return null;
  return new TextEncoder().encode(secret);
}

/** Constant-time compare that never leaks the length of the secret. */
function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** Generate a secret for a fresh deployment. */
export function suggestChannelSecret(): string {
  return randomBytes(32).toString("base64url");
}

function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

/**
 * Gate for every channel route.
 * Returns either `{ ok: true, principal }` or a ready-to-return 401 response.
 */
export function requireChannel(request: Request): { ok: true; principal: ChannelPrincipal } | { ok: false; response: NextResponse } {
  const expected = secretKey();
  if (!expected) {
    // fail closed: an unconfigured integration must never be trusted
    return {
      ok: false,
      response: jsonError(503, "CHANNEL_NOT_CONFIGURED", "Channel API is not configured on this server"),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented || !safeEqual(presented, process.env.CHANNEL_API_SECRET ?? "")) {
    return { ok: false, response: jsonError(401, "UNAUTHORIZED", "Invalid channel credentials") };
  }

  return { ok: true, principal: { channel: request.headers.get("x-channel") ?? "telegram" } };
}

/** Issue the customer token returned by `identifyCustomer`. */
export async function signCustomerToken(customer: {
  userId: string;
  telegramId: string | null;
  workspaceId: string;
  locale: string;
}): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("CHANNEL_API_SECRET is not configured");
  return new SignJWT({
    tid: customer.telegramId,
    wid: customer.workspaceId,
    locale: customer.locale,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(customer.userId)
    .setIssuer("nobatyar")
    .setAudience(CUSTOMER_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CUSTOMER_TOKEN_DAYS}d`)
    .sign(key);
}

/**
 * Verify the customer token *and* that the Telegram account presenting it is
 * the one the token was issued to. A bot bug (or a replayed token from another
 * chat) therefore cannot act as somebody else.
 */
export async function verifyCustomerToken(
  request: Request,
): Promise<{ ok: true; principal: CustomerPrincipal } | { ok: false; response: NextResponse }> {
  const token = request.headers.get("x-customer-token");
  if (!token) {
    return { ok: false, response: jsonError(401, "NO_CUSTOMER_TOKEN", "Missing X-Customer-Token header") };
  }

  const key = secretKey();
  if (!key) {
    return { ok: false, response: jsonError(503, "CHANNEL_NOT_CONFIGURED", "Channel API is not configured on this server") };
  }

  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: "nobatyar",
      audience: CUSTOMER_AUDIENCE,
    });
    const telegramId = typeof payload.tid === "string" ? payload.tid : null;
    const workspaceId = typeof payload.wid === "string" ? payload.wid : null;
    if (!payload.sub || !workspaceId) {
      return { ok: false, response: jsonError(401, "BAD_TOKEN", "Malformed customer token") };
    }

    // when the caller identifies itself as a Telegram chat, it must be the
    // same chat the token was minted for
    const claimedChat = request.headers.get("x-telegram-id");
    if (telegramId && claimedChat && claimedChat !== telegramId) {
      return {
        ok: false,
        response: jsonError(403, "IDENTITY_MISMATCH", "This token belongs to a different Telegram account"),
      };
    }

    return {
      ok: true,
      principal: {
        userId: payload.sub,
        telegramId,
        workspaceId,
        locale: typeof payload.locale === "string" ? payload.locale : "fa",
      },
    };
  } catch {
    return { ok: false, response: jsonError(401, "BAD_TOKEN", "Invalid or expired customer token") };
  }
}

export { CUSTOMER_TOKEN_DAYS };

/** Localised, machine-readable error codes the bot knows how to phrase. */
export type ChannelErrorCode =
  | "CHANNEL_NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "NO_CUSTOMER_TOKEN"
  | "BAD_TOKEN"
  | "IDENTITY_MISMATCH"
  | "VALIDATION"
  | "NOT_FOUND"
  | "SLOT_TAKEN"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "INTERNAL";

export function channelError(status: number, code: ChannelErrorCode, message: string, extra?: Record<string, unknown>) {
  return jsonError(status, code, message, extra);
}
