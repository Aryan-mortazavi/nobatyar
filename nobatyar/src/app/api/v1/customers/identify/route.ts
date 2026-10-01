import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/auth";
import { channelError, requireChannel, signCustomerToken } from "@/lib/channel-auth";
import { ok, packageView, resolveLocale } from "@/lib/channel-views";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { normalisePhone } from "@/lib/phone";
import { activePurchasesFor } from "@/lib/packages";
import { getWorkspace } from "@/lib/queries";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const identifySchema = z.object({
  telegramId: z.string().regex(/^\d{5,20}$/, "bad telegram id"),
  telegramUsername: z.string().trim().max(64).optional().or(z.literal("")),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(24),
  locale: z.enum(["fa", "en"]).default("fa"),
  /** true when the customer re-confirms an existing web account */
  email: z.string().email().max(160).optional().or(z.literal("")),
});

/**
 * POST /api/v1/customers/identify — link a Telegram account to a customer.
 *
 * The whole point of the integration: after this call the person is a real
 * `User` in the web app, so anything booked in Telegram shows up on the
 * website, in the dashboard and in the owner's reports immediately.
 *
 * Matching rules, in order:
 *   1. a customer with the same `telegramId` (they already introduced themselves)
 *   2. a customer with the same phone number (they booked on the web before)
 *   3. a brand new customer
 *
 * Case 2 *adopts* the existing account: history, packages and appointments stay
 * attached to the person instead of being split in two.
 */
export async function POST(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const parsed = identifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return channelError(422, "VALIDATION", "Invalid identify payload", {
      fields: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const input = parsed.data;
  const limit = rateLimit(`channel:identify:${input.telegramId}`, 12, 60_000);
  if (!limit.ok) return channelError(429, "RATE_LIMITED", "Too many identification attempts");

  const phone = normalisePhone(input.phone);
  if (!phone.ok) {
    return channelError(422, "VALIDATION", "Invalid mobile number", { reason: phone.reason });
  }

  const workspace = await getWorkspace();
  const locale = resolveLocale(input.locale, workspace.defaultLocale);

  const byTelegram = await prisma.user.findUnique({
    where: { telegramId: input.telegramId },
  });
  const byPhone = await prisma.user.findFirst({ where: { phone: phone.phone } });

  // one Telegram account may not hijack somebody else's phone-linked account
  if (byPhone && byPhone.telegramId && byPhone.telegramId !== input.telegramId) {
    return channelError(409, "CONFLICT", "This phone number is linked to another Telegram account", {
      code: "PHONE_TAKEN",
    });
  }
  if (byTelegram && byTelegram.telegramId !== input.telegramId) {
    return channelError(409, "CONFLICT", "Telegram identity mismatch");
  }

  let user = byTelegram ?? byPhone;
  const isNew = !user;

  if (user) {
    // refresh what the channel just told us, never blank out existing values
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramId: input.telegramId,
        telegramUsername: input.telegramUsername || user.telegramUsername || null,
        telegramLinkedAt: user.telegramLinkedAt ?? new Date(),
        name: user.name || input.name,
        phone: phone.phone,
        lastLoginAt: new Date(),
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        // a channel customer has no password: they authenticate with the token
        // minted below, never with a web login
        email: input.email || `tg${input.telegramId}@channel.nobatyar.local`,
        passwordHash: "!channel",
        name: input.name,
        phone: phone.phone,
        locale,
        platformRole: "CUSTOMER",
        telegramId: input.telegramId,
        telegramUsername: input.telegramUsername || null,
        telegramLinkedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  }

  const token = await signCustomerToken({
    userId: user.id,
    telegramId: user.telegramId,
    workspaceId: workspace.id,
    locale,
  });

  const purchases = await activePurchasesFor(workspace.id, user.id);

  await audit({
    action: isNew ? "CHANNEL_CUSTOMER_NEW" : "CHANNEL_CUSTOMER_LINK",
    workspaceId: workspace.id,
    actorUserId: user.id,
    actorEmail: user.email,
    entity: "user",
    entityId: user.id,
    meta: { channel: gate.principal.channel, telegramId: input.telegramId, adopted: Boolean(byPhone) },
  });

  const t = getDictionary(locale);
  return ok({
    token,
    customer: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      locale: user.locale === "en" ? "en" : "fa",
      telegramUsername: user.telegramUsername,
      linkedAt: user.telegramLinkedAt?.toISOString() ?? null,
    },
    welcome: t.channel.welcome.replace("{business}", workspace.nameFa ?? workspace.name),
    labels: {
      book: t.channel.book,
      myAppointments: t.channel.myAppointments,
      myPackages: t.channel.myPackages,
      support: t.channel.support,
      website: t.channel.website,
      menu: t.channel.menu,
    },
    packages: purchases.map((purchase) =>
      packageView(
        {
          id: purchase.id,
          totalSessions: purchase.totalSessions,
          usedSessions: purchase.usedSessions,
          expiresAt: purchase.expiresAt,
          package: { name: purchase.package.name, nameFa: purchase.package.nameFa },
        },
        locale,
      ),
    ),
  });
}
