"use server";

import { z } from "zod";

import { getWorkspace } from "@/lib/queries";
import { addDays, civilOf, civilToDateKey, parseDateKey, toJalali } from "@/lib/dates";
import { availabilityMap, daySlots } from "@/lib/availability-server";
import { rateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";

const monthQuery = z.object({
  serviceId: z.string().min(8),
  staffId: z.string().min(8).optional().or(z.literal("any")).or(z.literal("")),
  /** empty string = "any branch" */
  locationId: z.string().min(8).optional().or(z.literal("")),
});

const dayQuery = monthQuery.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type RemoteDay = {
  key: string;
  bookable: boolean;
  freeCount: number;
  isHoliday: boolean;
  isClosed: boolean;
};

export type RemoteSlot = {
  start: number;
  label: string;
  available: boolean;
  reason?: string;
};

/** Availability heat map for a whole Jalali month (public, rate limited). */
export async function fetchMonthAction(
  input: z.infer<typeof monthQuery>,
): Promise<{ ok: true; days: Record<string, RemoteDay> } | { ok: false; error: string }> {
  const parsed = monthQuery.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const session = await getSession();
  const limit = rateLimit(`month:${session?.sub ?? "anon"}`, 240, 60_000);
  if (!limit.ok) return { ok: false, error: "RATE_LIMITED" };

  const workspace = await getWorkspace();
  const start = civilOf(new Date(), workspace.timezone);
  const days = Math.min(workspace.maxAdvanceDays, 60);
  const locationId = parsed.data.locationId || undefined;

  const map = await availabilityMap({
    workspaceId: workspace.id,
    serviceId: parsed.data.serviceId,
    staffId: parsed.data.staffId && parsed.data.staffId !== "any" ? parsed.data.staffId : undefined,
    ...(locationId ? { locationId } : {}),
    startDate: start,
    days,
  });

  const out: Record<string, RemoteDay> = {};
  for (const [key, summary] of map) {
    out[key] = {
      key,
      bookable: summary.freeSlots > 0,
      freeCount: summary.freeSlots,
      isHoliday: summary.isHoliday,
      isClosed: summary.isClosed,
    };
  }
  return { ok: true, days: out };
}

/** Slots of one concrete day. */
export async function fetchDayAction(
  input: z.infer<typeof dayQuery>,
): Promise<{ ok: true; slots: RemoteSlot[]; staffCount: number } | { ok: false; error: string }> {
  const parsed = dayQuery.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const session = await getSession();
  const limit = rateLimit(`day:${session?.sub ?? "anon"}`, 600, 60_000);
  if (!limit.ok) return { ok: false, error: "RATE_LIMITED" };

  const workspace = await getWorkspace();
  const date = parseDateKey(parsed.data.date);
  const locationId = parsed.data.locationId || undefined;

  const { slots, staff } = await daySlots({
    workspaceId: workspace.id,
    serviceId: parsed.data.serviceId,
    date,
    ...(locationId ? { locationId } : {}),
    ...(parsed.data.staffId && parsed.data.staffId !== "any"
      ? { staffId: parsed.data.staffId }
      : {}),
  });

  return {
    ok: true,
    slots: slots.map((slot) => ({
      start: slot.start,
      label: slot.label,
      available: slot.available,
      ...(slot.reason ? { reason: slot.reason } : {}),
    })),
    staffCount: staff.length,
  };
}

/** Next bookable day + its slots (the "earliest available" shortcut). */
export async function fetchNextAvailableAction(
  input: z.infer<typeof monthQuery>,
): Promise<{ ok: true; date: string; slots: RemoteSlot[] } | { ok: false; error: string }> {
  const parsed = monthQuery.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const workspace = await getWorkspace();
  const start = civilOf(new Date(), workspace.timezone);
  const locationId = parsed.data.locationId || undefined;

  const map = await availabilityMap({
    workspaceId: workspace.id,
    serviceId: parsed.data.serviceId,
    staffId: parsed.data.staffId && parsed.data.staffId !== "any" ? parsed.data.staffId : undefined,
    ...(locationId ? { locationId } : {}),
    startDate: start,
    days: Math.min(workspace.maxAdvanceDays, 45),
  });

  const entries = [...map.entries()]
    .filter(([, summary]) => summary.freeSlots > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const first = entries[0];
  if (!first) return { ok: false, error: "NONE" };

  const { slots } = await daySlots({
    workspaceId: workspace.id,
    serviceId: parsed.data.serviceId,
    date: parseDateKey(first[0]),
    ...(locationId ? { locationId } : {}),
    ...(parsed.data.staffId && parsed.data.staffId !== "any"
      ? { staffId: parsed.data.staffId }
      : {}),
  });

  return {
    ok: true,
    date: first[0],
    slots: slots
      .filter((slot) => slot.available)
      .slice(0, 12)
      .map((slot) => ({ start: slot.start, label: slot.label, available: true })),
  };
}

export { addDays, civilToDateKey, toJalali };
