/**
 * Server-side availability service.
 *
 * Loads schedule data from the database and feeds the pure engine in
 * `lib/availability.ts`. This is the only module the UI talks to.
 */
import "server-only";
import { cache } from "react";

import {
  buildDayMap,
  fitsInDay,
  generateSlots,
  isBookable,
  mergeSlots,
  type DaySummary,
  type Interval,
  type Slot,
  type SlotPlan,
  type WeeklyWindow,
} from "./availability";
import { addDays, civilOf, zonedMinuteToUtc, type CivilDate } from "./dates";
import { prisma } from "./db";

const MIN = 60_000;

type WorkspacePolicy = {
  timezone: string;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  slotStepMinutes: number;
};

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED"];

export type StaffSchedule = {
  staffId: string;
  name: string;
  slug: string;
  title: string | null;
  photoUrl: string | null;
  windows: WeeklyWindow[];
  serviceIds: string[];
  locationIds: string[];
};

/** Every bookable specialist of a workspace, with their weekly schedule. */
export const getStaffSchedules = cache(async (workspaceId: string): Promise<StaffSchedule[]> => {
  const staff = await prisma.staffMember.findMany({
    where: { workspaceId, isActive: true, isBookable: true },
    include: {
      workingHours: { where: { isActive: true } },
      services: true,
      locations: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return staff.map((member) => ({
    staffId: member.id,
    name: member.name,
    slug: member.slug,
    title: member.title,
    photoUrl: member.photoUrl,
    windows: member.workingHours.map((w) => ({
      weekday: w.weekday,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
    })),
    serviceIds: member.services.map((s) => s.serviceId),
    locationIds: member.locations.map((link) => link.locationId),
  }));
});

async function policyOf(workspaceId: string): Promise<WorkspacePolicy> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      timezone: true,
      minNoticeMinutes: true,
      maxAdvanceDays: true,
      slotStepMinutes: true,
    },
  });
  return workspace;
}

/** Absolute intervals that make a day unavailable (holidays + time off). */
async function blockedIntervals(
  workspaceId: string,
  staffId: string,
  from: CivilDate,
  days: number,
  timeZone: string,
): Promise<Interval[]> {
  const rangeStart = zonedMinuteToUtc(from, 0, timeZone);
  const rangeEnd = zonedMinuteToUtc(addDays(from, days), 0, timeZone);

  const [holidays, timeOff] = await Promise.all([
    prisma.holiday.findMany({
      where: {
        workspaceId,
        date: { gte: rangeStart, lt: rangeEnd },
      },
    }),
    prisma.timeOff.findMany({
      where: { staffId, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
    }),
  ]);

  return [
    ...holidays.map((h) => ({
      start: zonedMinuteToUtc(civilOf(h.date, timeZone), 0, timeZone).getTime(),
      end: zonedMinuteToUtc(civilOf(h.date, timeZone), 24 * 60, timeZone).getTime(),
    })),
    ...timeOff.map((t) => ({ start: t.startsAt.getTime(), end: t.endsAt.getTime() })),
  ];
}

/** Booked intervals of one specialist, padded with each service's buffers. */
async function busyIntervals(
  staffId: string,
  from: CivilDate,
  days: number,
  timeZone: string,
  excludeAppointmentId?: string,
): Promise<Interval[]> {
  const rangeStart = zonedMinuteToUtc(from, 0, timeZone);
  const rangeEnd = zonedMinuteToUtc(addDays(from, days), 0, timeZone);

  const rows = await prisma.appointment.findMany({
    where: {
      staffId,
      status: { in: ACTIVE_STATUSES },
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    include: { service: { select: { bufferBeforeMin: true, bufferAfterMin: true } } },
  });

  return rows.map((row) => ({
    start: row.startsAt.getTime() - row.service.bufferBeforeMin * MIN,
    end: row.endsAt.getTime() + row.service.bufferAfterMin * MIN,
  }));
}

export type PlanContext = {
  workspaceId: string;
  serviceId: string;
  serviceDuration: number;
  bufferBefore: number;
  bufferAfter: number;
  timeZone: string;
  policy: WorkspacePolicy;
  startDate: CivilDate;
  days: number;
  now: number;
};

/** Assemble everything the pure engine needs for one specialist. */
export async function buildPlan(
  ctx: Omit<PlanContext, "policy" | "now" | "timeZone">,
  schedule: StaffSchedule,
  overrides: { now?: number; excludeAppointmentId?: string } = {},
): Promise<SlotPlan> {
  const policy = await policyOf(ctx.workspaceId);
  const now = overrides.now ?? Date.now();
  const [blocked, busy] = await Promise.all([
    blockedIntervals(ctx.workspaceId, schedule.staffId, ctx.startDate, ctx.days, policy.timezone),
    busyIntervals(schedule.staffId, ctx.startDate, ctx.days, policy.timezone, overrides.excludeAppointmentId),
  ]);

  return {
    date: ctx.startDate,
    timeZone: policy.timezone,
    windows: schedule.windows,
    blocked,
    busy,
    durationMin: ctx.serviceDuration,
    bufferBeforeMin: ctx.bufferBefore,
    bufferAfterMin: ctx.bufferAfter,
    stepMin: policy.slotStepMinutes,
    now,
    minNoticeMin: policy.minNoticeMinutes,
    latestAt: now + policy.maxAdvanceDays * 24 * 60 * MIN,
  };
}

export type StaffWithSlots = StaffSchedule & { slots: Slot[] };

/**
 * Specialists who can take this service, narrowed to one branch when the
 * customer picked a location. A branch that has no explicit staffing list
 * falls back to the whole team, so a single-branch business behaves exactly
 * like before.
 */
async function eligibleStaff(
  workspaceId: string,
  serviceId: string,
  locationId?: string,
): Promise<{ schedules: StaffSchedule[]; all: StaffSchedule[] }> {
  const service = await prisma.service.findUniqueOrThrow({
    where: { id: serviceId },
    select: {
      durationMin: true,
      bufferBeforeMin: true,
      bufferAfterMin: true,
      staff: { select: { staffId: true } },
      locations: locationId ? { where: { locationId }, select: { locationId: true } } : false,
    },
  });

  const all = await getStaffSchedules(workspaceId);
  const linked = all.filter((member) =>
    service.staff.some((link) => link.staffId === member.staffId),
  );

  if (!locationId) return { schedules: linked, all };

  // the branch does not offer this service at all
  if (service.locations && service.locations.length === 0) {
    return { schedules: [], all: linked };
  }

  const atLocation = linked.filter((member) => member.locationIds.includes(locationId));
  return { schedules: atLocation.length > 0 ? atLocation : linked, all: linked };
}

/**
 * Slots of one civil day for the given specialists.
 * When `staffId` is omitted the union across all eligible specialists is used,
 * which powers the "earliest available" option.
 */
export async function daySlots(params: {
  workspaceId: string;
  serviceId: string;
  date: CivilDate;
  staffId?: string;
  locationId?: string;
  now?: number;
  excludeAppointmentId?: string;
}): Promise<{ slots: Slot[]; staff: StaffWithSlots[] }> {
  const service = await prisma.service.findUniqueOrThrow({
    where: { id: params.serviceId },
    select: { durationMin: true, bufferBeforeMin: true, bufferAfterMin: true },
  });

  const { schedules: candidates } = await eligibleStaff(
    params.workspaceId,
    params.serviceId,
    params.locationId,
  );
  const eligible = params.staffId
    ? candidates.filter((member) => member.staffId === params.staffId)
    : candidates;

  const base = {
    workspaceId: params.workspaceId,
    serviceId: params.serviceId,
    serviceDuration: service.durationMin,
    bufferBefore: service.bufferBeforeMin,
    bufferAfter: service.bufferAfterMin,
    startDate: params.date,
    days: 1,
  };

  const results = await Promise.all(
    eligible.map(async (schedule) => {
      const plan = await buildPlan(base, schedule, {
        ...(params.now !== undefined ? { now: params.now } : {}),
        ...(params.excludeAppointmentId ? { excludeAppointmentId: params.excludeAppointmentId } : {}),
      });
      return { ...schedule, slots: generateSlots({ ...plan, date: params.date }) };
    }),
  );

  if (params.staffId || eligible.length <= 1) {
    return { slots: results[0]?.slots ?? [], staff: results };
  }

  // union: a time is free if at least one specialist can take it
  return { slots: mergeSlots(results.map((entry) => entry.slots)), staff: results };
}

/** Free/total per day across the whole booking horizon (calendar heat map). */
export async function availabilityMap(params: {
  workspaceId: string;
  serviceId: string;
  staffId?: string;
  locationId?: string;
  days: number;
  startDate: CivilDate;
  now?: number;
}): Promise<Map<string, DaySummary>> {
  const service = await prisma.service.findUniqueOrThrow({
    where: { id: params.serviceId },
    select: { durationMin: true, bufferBeforeMin: true, bufferAfterMin: true },
  });
  const { schedules: candidates } = await eligibleStaff(
    params.workspaceId,
    params.serviceId,
    params.locationId,
  );
  const eligible = params.staffId
    ? candidates.filter((member) => member.staffId === params.staffId)
    : candidates;
  const now = params.now ?? Date.now();

  const plans = await Promise.all(
    eligible.map((schedule) =>
      buildPlan(
        {
          workspaceId: params.workspaceId,
          serviceId: params.serviceId,
          serviceDuration: service.durationMin,
          bufferBefore: service.bufferBeforeMin,
          bufferAfter: service.bufferAfterMin,
          startDate: params.startDate,
          days: params.days,
        },
        schedule,
        { now },
      ),
    ),
  );

  if (plans.length === 0) return new Map();
  if (params.staffId || plans.length === 1) {
    return buildDayMap({ ...plans[0], startDate: params.startDate, days: params.days });
  }

  // merge the specialists: free if anybody is free, capacity = summed
  const merged = new Map<string, DaySummary>();
  for (let i = 0; i < params.days; i += 1) {
    const date = addDays(params.startDate, i);
    const perStaff = plans.map((plan) => buildDayMap({ ...plan, startDate: date, days: 1 }).get(`${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`));
    const summaries = perStaff.filter((s): s is DaySummary => Boolean(s));
    if (summaries.length === 0) continue;
    const first = summaries[0];
    const freeSlots = summaries.reduce((sum, s) => sum + s.freeSlots, 0);
    const totalSlots = summaries.reduce((sum, s) => sum + s.totalSlots, 0);
    merged.set(first.key, {
      ...first,
      freeSlots,
      totalSlots,
      bookedSlots: summaries.reduce((sum, s) => sum + s.bookedSlots, 0),
      minutesAvailable: summaries.reduce((sum, s) => sum + s.minutesAvailable, 0),
      bookedMinutes: summaries.reduce((sum, s) => sum + s.bookedMinutes, 0),
      isClosed: summaries.every((s) => s.isClosed),
      utilization: totalSlots === 0 ? 0 : summaries.reduce((sum, s) => sum + s.bookedSlots, 0) / totalSlots,
    });
  }
  return merged;
}

/** Final server-side check right before a booking is written. */
export async function verifySlot(params: {
  workspaceId: string;
  serviceId: string;
  staffId: string;
  startMs: number;
  locationId?: string;
  excludeAppointmentId?: string;
}): Promise<{ ok: true; endMs: number } | { ok: false; reason: "unavailable" }> {
  const service = await prisma.service.findUniqueOrThrow({
    where: { id: params.serviceId },
    select: { durationMin: true, bufferBeforeMin: true, bufferAfterMin: true },
  });
  const { schedules } = await eligibleStaff(
    params.workspaceId,
    params.serviceId,
    params.locationId,
  );
  const schedule = schedules.find((s) => s.staffId === params.staffId);
  if (!schedule) return { ok: false, reason: "unavailable" };

  const policy = await policyOf(params.workspaceId);
  const timeZone = policy.timezone;
  const date = civilOf(new Date(params.startMs), timeZone);

  const [blocked, busy] = await Promise.all([
    blockedIntervals(params.workspaceId, params.staffId, date, 1, timeZone),
    busyIntervals(params.staffId, date, 1, timeZone, params.excludeAppointmentId),
  ]);

  const plan: SlotPlan = {
    date,
    timeZone,
    windows: schedule.windows,
    blocked,
    busy,
    durationMin: service.durationMin,
    bufferBeforeMin: service.bufferBeforeMin,
    bufferAfterMin: service.bufferAfterMin,
    stepMin: policy.slotStepMinutes,
    now: Date.now(),
    minNoticeMin: policy.minNoticeMinutes,
    latestAt: Date.now() + policy.maxAdvanceDays * 24 * 60 * MIN,
  };

  const result = isBookable(plan, params.startMs);
  if (!result.ok) return { ok: false, reason: "unavailable" };

  // The appointment must sit *inside* the civil day (it may not run past
  // midnight). This is a containment check, not an intersection one.
  const end = params.startMs + service.durationMin * MIN;
  const [dayStart, dayEnd] = intervalOfDay(date, timeZone);
  if (!fitsInDay(params.startMs, end, dayStart, dayEnd)) {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, endMs: end };
}

function intervalOfDay(date: CivilDate, timeZone: string): [number, number] {
  return [
    zonedMinuteToUtc(date, 0, timeZone).getTime(),
    zonedMinuteToUtc(date, 24 * 60, timeZone).getTime(),
  ];
}
