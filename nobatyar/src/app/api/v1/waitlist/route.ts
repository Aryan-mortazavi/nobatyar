import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/auth";
import { channelError, requireChannel, verifyCustomerToken } from "@/lib/channel-auth";
import { ok, resolveLocale } from "@/lib/channel-views";
import { civilOf, parseDateKey, sameCivilDay, zonedMinuteToUtc } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const waitlistSchema = z.object({
  serviceId: z.string().min(8),
  staffId: z.string().min(8).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** minutes of the day, e.g. 570 = 09:30 */
  preferredStartMinute: z.coerce.number().int().min(0).max(1439).optional(),
  notes: z.string().trim().max(500).optional(),
  locale: z.enum(["fa", "en"]).default("fa"),
});

/**
 * POST /api/v1/waitlist — "tell me when something frees up".
 *
 * The waitlist is one of the highest-value features of the product, and a chat
 * channel is where people actually ask for it: nobody opens a website to be
 * told a slot opened, but everybody reads a bot message about it.
 */
export async function POST(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const customer = await verifyCustomerToken(request);
  if (!customer.ok) return customer.response;

  const parsed = waitlistSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return channelError(422, "VALIDATION", "Invalid waitlist payload", {
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }

  const key = customer.principal.telegramId ?? customer.principal.userId;
  if (!rateLimit(`channel:waitlist:${key}`, 10, 60_000).ok) {
    return channelError(429, "RATE_LIMITED", "Too many waitlist requests");
  }

  const workspace = await getWorkspace();
  const input = parsed.data;
  const locale = resolveLocale(input.locale, "fa");
  const t = getDictionary(locale);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: customer.principal.userId },
    select: { id: true, name: true, phone: true, email: true },
  });

  const day = parseDateKey(input.date);
  if (day.year < 2000 || day.month < 1 || day.month > 12 || day.day < 1 || day.day > 31) {
    return channelError(422, "VALIDATION", "Invalid date");
  }

  const staffId = input.staffId && input.staffId !== "any" ? input.staffId : null;
  const preferredDate = zonedMinuteToUtc(day, input.preferredStartMinute ?? 0, workspace.timezone);

  // one live entry per customer + service + day, whatever the channel asks twice
  const pending = await prisma.waitlistEntry.findMany({
    where: {
      workspaceId: workspace.id,
      customerUserId: user.id,
      serviceId: input.serviceId,
      status: "PENDING",
    },
    select: { id: true, preferredDate: true },
  });
  const duplicate = pending.find((entry) =>
    sameCivilDay(entry.preferredDate, day, workspace.timezone),
  );
  if (duplicate) {
    return ok({ created: false, entryId: duplicate.id, date: input.date, locale });
  }

  const entry = await prisma.waitlistEntry.create({
    data: {
      workspaceId: workspace.id,
      serviceId: input.serviceId,
      staffId,
      customerUserId: user.id,
      customerName: user.name,
      customerPhone: user.phone ?? "",
      customerEmail: user.email?.endsWith("@channel.nobatyar.local") ? null : user.email,
      preferredDate,
      preferredStartMinute: input.preferredStartMinute ?? null,
      notes: input.notes ?? null,
      status: "PENDING",
    },
    select: { id: true },
  });

  await audit({
    action: "WAITLIST_JOIN",
    workspaceId: workspace.id,
    actorUserId: user.id,
    entity: "waitlistEntry",
    entityId: entry.id,
    meta: { channel: gate.principal.channel, date: input.date, staffId },
  });

  return ok({
    created: true,
    entryId: entry.id,
    date: input.date,
    locale,
    labels: { waitlistOffer: t.channel.waitlistOffer, website: t.channel.website },
  });
}

/** GET /api/v1/waitlist — is this customer waiting for anything? */
export async function GET(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const customer = await verifyCustomerToken(request);
  if (!customer.ok) return customer.response;

  const workspace = await getWorkspace();
  const locale = resolveLocale(request.nextUrl.searchParams.get("locale"), "fa");
  const t = getDictionary(locale);

  const entries = await prisma.waitlistEntry.findMany({
    where: {
      workspaceId: workspace.id,
      customerUserId: customer.principal.userId,
      status: { in: ["PENDING", "NOTIFIED"] },
    },
    include: { service: { select: { id: true, name: true, nameFa: true } } },
    orderBy: { preferredDate: "asc" },
  });

  return ok({
    labels: { none: t.channel.noAppointments, waitlistOffer: t.channel.waitlistOffer },
    entries: entries.map((entry) => ({
      id: entry.id,
      serviceId: entry.serviceId,
      serviceTitle: locale === "fa" ? (entry.service.nameFa ?? entry.service.name) : entry.service.name,
      date: entry.preferredDate ? civilOf(entry.preferredDate, workspace.timezone) : null,
      preferredStartMinute: entry.preferredStartMinute,
      status: entry.status,
    })),
  });
}
