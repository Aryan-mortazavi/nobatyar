import type { NextRequest } from "next/server";
import { z } from "zod";

import { channelError, requireChannel } from "@/lib/channel-auth";
import { ok, resolveLocale } from "@/lib/channel-views";
import { civilOf, parseDateKey, toJalali } from "@/lib/dates";
import { availabilityMap, daySlots } from "@/lib/availability-server";
import { getDictionary } from "@/lib/dictionaries";
import { prisma } from "@/lib/db";
import { getWorkspace } from "@/lib/queries";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  serviceId: z.string().min(8),
  /** "any" (or omitted) = the union across every eligible specialist */
  staffId: z.string().min(8).optional().or(z.literal("any")).or(z.literal("")),
  /** same convention for the branch */
  locationId: z.string().min(8).optional().or(z.literal("any")).or(z.literal("")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  locale: z.enum(["fa", "en"]).default("fa"),
});

/**
 * GET /api/v1/availability
 *
 *   ?serviceId=…&date=2026-10-01        → the slots of one day
 *   ?serviceId=…&days=30                 → a heat map for the calendar
 *
 * Read-only and rate limited per customer/channel, and served by the *same*
 * availability engine as the website — a channel can never see a slot the web
 * app would refuse, and vice versa.
 */
export async function GET(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return channelError(422, "VALIDATION", "Invalid availability query", {
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }

  const workspace = await getWorkspace();
  const key = request.headers.get("x-telegram-id") ?? "anon";
  if (!rateLimit(`channel:availability:${key}`, 240, 60_000).ok) {
    return channelError(429, "RATE_LIMITED", "Too many availability requests");
  }

  const { serviceId, staffId, locationId, date } = parsed.data;
  const locale = resolveLocale(parsed.data.locale, workspace.defaultLocale);
  const staffIdOrUndefined = staffId && staffId !== "any" ? staffId : undefined;
  const locationIdOrUndefined = locationId && locationId !== "any" ? locationId : undefined;

  // Resolve the service up front. The availability engine below loads it with
  // findUniqueOrThrow, so an unknown id used to escape as an unhandled Prisma
  // P2025 and a 500 — an authenticated caller could turn a typo into a server
  // error (and, in development, a stack trace in the response).
  const service = await prisma.service.findFirst({
    where: { id: serviceId, workspaceId: workspace.id },
    select: { id: true, isActive: true },
  });
  if (!service) {
    return channelError(404, "NOT_FOUND", "No such service in this workspace");
  }

  // ── one concrete day: the exact slots ────────────────────────────────────
  if (date) {
    const civil = parseDateKey(date);
    const { slots, staff } = await daySlots({
      workspaceId: workspace.id,
      serviceId,
      date: civil,
      ...(staffIdOrUndefined ? { staffId: staffIdOrUndefined } : {}),
      ...(locationIdOrUndefined ? { locationId: locationIdOrUndefined } : {}),
    });

    const available = slots.filter((slot) => slot.available);
    return ok({
      kind: "day" as const,
      date,
      jalali: toJalali(civil),
      timezone: workspace.timezone,
      eligibleStaff: staff.map((member) => ({ id: member.staffId, name: member.name })),
      total: slots.length,
      availableCount: available.length,
      slots: slots.map((slot) => ({
        start: slot.start,
        iso: new Date(slot.start).toISOString(),
        label: slot.label,
        end: slot.end,
        endIso: new Date(slot.end).toISOString(),
        available: slot.available,
        ...(slot.reason ? { reason: slot.reason } : {}),
      })),
    });
  }

  // ── a window of days: what a calendar needs ──────────────────────────────
  const days = Math.min(Number(params.days ?? 30) || 30, workspace.maxAdvanceDays, 90);
  const map = await availabilityMap({
    workspaceId: workspace.id,
    serviceId,
    ...(staffIdOrUndefined ? { staffId: staffIdOrUndefined } : {}),
    ...(locationIdOrUndefined ? { locationId: locationIdOrUndefined } : {}),
    startDate: civilOf(new Date(), workspace.timezone),
    days,
  });

  const t = getDictionary(locale);
  return ok({
    kind: "range" as const,
    timezone: workspace.timezone,
    days: [...map.values()].map((day) => ({
      date: day.key,
      bookable: day.freeSlots > 0,
      freeCount: day.freeSlots,
      isHoliday: day.isHoliday,
      isClosed: day.isClosed,
      isPast: day.isPast,
    })),
    labels: { closed: t.status.CANCELLED, pickDate: t.channel.pickDate },
  });
}
