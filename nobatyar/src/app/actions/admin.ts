"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { audit, getSession, requireWorkspace } from "@/lib/auth";
import { rescheduleAppointment, updateAppointmentStatus } from "@/lib/booking";
import { fieldErrors, serviceSchema, settingsSchema, staffSchema, timeOffSchema, holidaySchema, appointmentStatusSchema } from "@/lib/validators";
import type { FormState } from "@/lib/form-state";
import { slugify } from "@/lib/utils";

export async function setAppointmentStatusAction(
  appointmentId: string,
  status: string,
  locale: string,
): Promise<FormState> {
  const parsed = appointmentStatusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const { session, workspace } = await requireWorkspace(locale);
  const result = await updateAppointmentStatus({
    appointmentId,
    status: parsed.data,
  });

  if (!result.ok) {
    return { ok: false, error: result.error === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_TRANSITION" };
  }

  await audit({
    action: `APPOINTMENT_${parsed.data}`,
    workspaceId: workspace.id,
    entity: "appointment",
    entityId: appointmentId,
    actorUserId: session.sub,
  });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export async function rescheduleAction(
  appointmentId: string,
  newStartMs: number,
  newStaffId: string | undefined,
  locale: string,
): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(locale);
  if (!Number.isFinite(newStartMs)) return { ok: false, error: "VALIDATION" };

  const result = await rescheduleAppointment({
    appointmentId,
    newStartMs,
    ...(newStaffId ? { newStaffId } : {}),
  });
  if (!result.ok) {
    return { ok: false, error: result.error === "SLOT_TAKEN" ? "SLOT_TAKEN" : "NOT_FOUND" };
  }

  await audit({
    action: "APPOINTMENT_RESCHEDULE",
    workspaceId: workspace.id,
    entity: "appointment",
    entityId: result.newId,
    actorUserId: session.sub,
  });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export async function saveServiceAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = String(formData.get("locale") ?? "fa");
  const { session, workspace } = await requireWorkspace(locale);

  const parsed = serviceSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    nameFa: formData.get("nameFa") ?? "",
    shortDesc: formData.get("shortDesc") ?? "",
    description: formData.get("description") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    durationMin: formData.get("durationMin"),
    bufferBeforeMin: formData.get("bufferBeforeMin") ?? 0,
    bufferAfterMin: formData.get("bufferAfterMin") ?? 0,
    priceAmount: formData.get("priceAmount") || undefined,
    color: formData.get("color") ?? "",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
    isPublic: formData.get("isPublic") === "on" || formData.get("isPublic") === "true",
    staffIds: formData.getAll("staffIds"),
  });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const data = {
    name: input.name,
    nameFa: input.nameFa || null,
    shortDesc: input.shortDesc || null,
    description: input.description || null,
    categoryId: input.categoryId || null,
    durationMin: input.durationMin,
    bufferBeforeMin: input.bufferBeforeMin,
    bufferAfterMin: input.bufferAfterMin,
    priceAmount: input.priceAmount ?? null,
    color: input.color || null,
    isActive: input.isActive,
    isPublic: input.isPublic,
  };

  const serviceId = input.id
    ? input.id
    : (
        await prisma.service.create({
          data: {
            ...data,
            slug: await uniqueSlug(input.name),
            workspaceId: workspace.id,
          },
          select: { id: true },
        })
      ).id;

  if (input.id) {
    await prisma.service.update({ where: { id: input.id }, data });
  }

  await prisma.staffService.deleteMany({ where: { serviceId } });
  if (input.staffIds.length > 0) {
    await prisma.staffService.createMany({
      data: input.staffIds.map((staffId) => ({ serviceId, staffId })),
    });
  }

  await audit({
    action: input.id ? "SERVICE_UPDATE" : "SERVICE_CREATE",
    workspaceId: workspace.id,
    entity: "service",
    entityId: serviceId,
    actorUserId: session.sub,
  });
  revalidatePath(`/${locale}/dashboard`, "layout");
  revalidatePath(`/${locale}/services`, "layout");
  return { ok: true, id: serviceId };
}

export async function deleteServiceAction(serviceId: string, locale: string): Promise<FormState> {
  const { workspace } = await requireWorkspace(locale, ["OWNER", "ADMIN"]);

  const [bookings, waitlist] = await Promise.all([
    prisma.appointment.count({ where: { serviceId } }),
    prisma.waitlistEntry.count({ where: { serviceId } }),
  ]);
  if (bookings > 0 || waitlist > 0) {
    return { ok: false, error: "IN_USE" };
  }

  await prisma.service.delete({ where: { id: serviceId } });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export async function saveStaffAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = String(formData.get("locale") ?? "fa");
  const { session, workspace } = await requireWorkspace(locale);

  const hours = formData
    .getAll("weekday")
    .map((weekday, index) => ({
      weekday: Number(weekday),
      startMinute: Number(formData.getAll("startMinute")[index] ?? 0),
      endMinute: Number(formData.getAll("endMinute")[index] ?? 0),
    }))
    .filter((row) => row.endMinute > row.startMinute);

  const parsed = staffSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    title: formData.get("title") ?? "",
    specialty: formData.get("specialty") ?? "",
    bio: formData.get("bio") ?? "",
    phone: formData.get("phone") ?? "",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
    isBookable: formData.get("isBookable") === "on" || formData.get("isBookable") === "true",
    serviceIds: formData.getAll("serviceIds"),
    workingHours: hours,
  });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const data = {
    name: input.name,
    title: input.title || null,
    specialty: input.specialty || null,
    bio: input.bio || null,
    phone: input.phone || null,
    isActive: input.isActive,
    isBookable: input.isBookable,
  };

  const staffId = input.id
    ? input.id
    : (
        await prisma.staffMember.create({
          data: { ...data, slug: await uniqueStaffSlug(input.name), workspaceId: workspace.id },
          select: { id: true },
        })
      ).id;

  if (input.id) await prisma.staffMember.update({ where: { id: input.id }, data });

  await prisma.workingHour.deleteMany({ where: { staffId } });
  if (input.workingHours.length > 0) {
    await prisma.workingHour.createMany({
      data: input.workingHours.map((row) => ({ ...row, staffId })),
    });
  }

  await prisma.staffService.deleteMany({ where: { staffId } });
  if (input.serviceIds.length > 0) {
    await prisma.staffService.createMany({
      data: input.serviceIds.map((serviceId) => ({ staffId, serviceId })),
    });
  }

  await audit({
    action: input.id ? "STAFF_UPDATE" : "STAFF_CREATE",
    workspaceId: workspace.id,
    entity: "staff",
    entityId: staffId,
    actorUserId: session.sub,
  });
  revalidatePath(`/${locale}/dashboard`, "layout");
  revalidatePath(`/${locale}/staff`, "layout");
  return { ok: true, id: staffId };
}

export async function addTimeOffAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = String(formData.get("locale") ?? "fa");
  const { workspace } = await requireWorkspace(locale);

  const parsed = timeOffSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }
  const { zonedMinuteToUtc, parseDateKey } = await import("@/lib/dates");

  await prisma.timeOff.create({
    data: {
      staffId: parsed.data.staffId,
      startsAt: zonedMinuteToUtc(parseDateKey(parsed.data.date), parsed.data.startMinute, workspace.timezone),
      endsAt: zonedMinuteToUtc(parseDateKey(parsed.data.date), parsed.data.endMinute, workspace.timezone),
      note: parsed.data.note || null,
    },
  });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export async function removeTimeOffAction(id: string, locale: string): Promise<FormState> {
  await requireWorkspace(locale);
  await prisma.timeOff.delete({ where: { id } });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export async function saveHolidayAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = String(formData.get("locale") ?? "fa");
  const { workspace } = await requireWorkspace(locale);

  const parsed = holidaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }
  const { zonedMinuteToUtc, parseDateKey } = await import("@/lib/dates");

  await prisma.holiday.upsert({
    where: { workspaceId_date: { workspaceId: workspace.id, date: zonedMinuteToUtc(parseDateKey(parsed.data.date), 0, workspace.timezone) } },
    create: {
      workspaceId: workspace.id,
      date: zonedMinuteToUtc(parseDateKey(parsed.data.date), 0, workspace.timezone),
      note: parsed.data.note || null,
    },
    update: { note: parsed.data.note || null },
  });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export async function removeHolidayAction(id: string, locale: string): Promise<FormState> {
  await requireWorkspace(locale);
  await prisma.holiday.delete({ where: { id } });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export async function saveSettingsAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = String(formData.get("locale") ?? "fa");
  const { session, workspace } = await requireWorkspace(locale, ["OWNER", "ADMIN"]);

  const bool = (name: string) => formData.get(name) === "on" || formData.get(name) === "true";
  const parsed = settingsSchema.safeParse({
    name: formData.get("name"),
    nameFa: formData.get("nameFa") ?? "",
    tagline: formData.get("tagline") ?? "",
    description: formData.get("description") ?? "",
    slug: formData.get("slug"),
    accentColor: formData.get("accentColor"),
    timezone: formData.get("timezone"),
    weekStart: formData.get("weekStart"),
    defaultLocale: formData.get("defaultLocale"),
    currency: formData.get("currency"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    address: formData.get("address") ?? "",
    minNoticeMinutes: formData.get("minNoticeMinutes"),
    maxAdvanceDays: formData.get("maxAdvanceDays"),
    slotStepMinutes: formData.get("slotStepMinutes"),
    cancellationWindowHrs: formData.get("cancellationWindowHrs"),
    allowGuestBooking: bool("allowGuestBooking"),
    requirePhone: bool("requirePhone"),
    autoConfirm: bool("autoConfirm"),
  });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      ...parsed.data,
      nameFa: parsed.data.nameFa || null,
      tagline: parsed.data.tagline || null,
      description: parsed.data.description || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      address: parsed.data.address || null,
    },
  });

  await audit({
    action: "SETTINGS_UPDATE",
    workspaceId: workspace.id,
    entity: "workspace",
    entityId: workspace.id,
    actorUserId: session.sub,
  });
  revalidatePath(`/${locale}/dashboard`, "layout");
  revalidatePath(`/${locale}`, "layout");
  return { ok: true };
}

export async function removeWaitlistAction(id: string, locale: string): Promise<FormState> {
  await requireWorkspace(locale);
  await prisma.waitlistEntry.delete({ where: { id } });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export async function notifyWaitlistAction(id: string, locale: string): Promise<FormState> {
  const { workspace } = await requireWorkspace(locale);
  const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
  if (!entry) return { ok: false, error: "NOT_FOUND" };

  const { notifyWaitlist } = await import("@/lib/notifications");
  await prisma.waitlistEntry.update({
    where: { id },
    data: { status: "NOTIFIED", notifiedAt: new Date() },
  });
  await notifyWaitlist(workspace.id, entry.staffId ?? "", id).catch(() => 0);
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "service";
  let candidate = base;
  let counter = 2;
  while (await prisma.service.findFirst({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${counter++}`;
  }
  return candidate;
}

async function uniqueStaffSlug(name: string): Promise<string> {
  const base = slugify(name) || "staff";
  let candidate = base;
  let counter = 2;
  while (await prisma.staffMember.findFirst({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${counter++}`;
  }
  return candidate;
}
