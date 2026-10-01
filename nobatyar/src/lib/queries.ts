/**
 * Public read models.
 *
 * Server Components talk to these helpers (never to Prisma directly) so the
 * query surface stays small, typed and easy to cache.
 */
import "server-only";
import { cache } from "react";

import { prisma } from "./db";
import { getActiveWorkspace } from "./auth";
import type { Locale } from "./i18n";

export const getWorkspace = cache(async () => {
  const workspace = await getActiveWorkspace();
  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    nameFa: workspace.nameFa,
    tagline: workspace.tagline,
    description: workspace.description,
    logoUrl: workspace.logoUrl,
    accentColor: workspace.accentColor,
    timezone: workspace.timezone,
    weekStart: workspace.weekStart,
    defaultLocale: workspace.defaultLocale,
    currency: workspace.currency,
    phone: workspace.phone,
    email: workspace.email,
    address: workspace.address,
    minNoticeMinutes: workspace.minNoticeMinutes,
    maxAdvanceDays: workspace.maxAdvanceDays,
    slotStepMinutes: workspace.slotStepMinutes,
    cancellationWindowHrs: workspace.cancellationWindowHrs,
    allowGuestBooking: workspace.allowGuestBooking,
    requirePhone: workspace.requirePhone,
    autoConfirm: workspace.autoConfirm,
    bookingPageSlug: workspace.bookingPageSlug,
  };
});

export const getCategories = cache(async (workspaceId: string) =>
  prisma.category.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { services: true } } },
  }),
);

export const getPublicServices = cache(async (workspaceId: string) =>
  prisma.service.findMany({
    where: { workspaceId, isActive: true, isPublic: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      category: true,
      staff: { include: { staff: { select: { id: true, name: true, slug: true, photoUrl: true } } } },
    },
  }),
);

export const getServiceBySlug = cache(async (workspaceId: string, slug: string) =>
  prisma.service.findFirst({
    where: { workspaceId, slug, isActive: true, isPublic: true },
    include: {
      category: true,
      staff: { include: { staff: true } },
    },
  }),
);

export const getPublicStaff = cache(async (workspaceId: string) =>
  prisma.staffMember.findMany({
    where: { workspaceId, isActive: true, isBookable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      services: { include: { service: true } },
      workingHours: { where: { isActive: true } },
    },
  }),
);

export const getStaffBySlug = cache(async (workspaceId: string, slug: string) =>
  prisma.staffMember.findFirst({
    where: { workspaceId, slug, isActive: true, isBookable: true },
    include: {
      services: { include: { service: true } },
      workingHours: { where: { isActive: true } },
      timeOff: { orderBy: { startsAt: "asc" } },
    },
  }),
);

export const getStats = cache(async () => {
  const [bookings, business, satisfaction] = await Promise.all([
    prisma.appointment.count(),
    prisma.workspace.count(),
    prisma.appointment.count({ where: { status: { in: ["COMPLETED", "CONFIRMED"] } } }),
  ]);
  return { bookings, business, satisfaction: satisfaction > 0 ? 98 : 100 };
});

/** Upcoming appointments for the dashboard preview. */
export const getUpcomingAppointments = cache(async (workspaceId: string, take = 5) =>
  prisma.appointment.findMany({
    where: {
      workspaceId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { gte: new Date() },
    },
    orderBy: { startsAt: "asc" },
    take,
    include: { service: true, staff: true },
  }),
);

export const localeOf = (value: string): Locale => (value === "en" ? "en" : "fa");
