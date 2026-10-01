/**
 * Every input that crosses the network boundary is parsed here.
 * Server actions accept nothing else — no `any`, no unchecked objects.
 */
import { z } from "zod";

const cuidLike = z.string().min(8).max(40);

export const localeSchema = z.enum(["fa", "en"]);

export const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(8).max(128),
  redirectTo: z.string().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "name too short").max(80),
    email: z.string().email().max(160),
    phone: z.string().trim().min(8).max(24).optional().or(z.literal("")),
    password: z
      .string()
      .min(8, "password too short")
      .max(128)
      .regex(/[A-Za-z]/, "password needs a letter")
      .regex(/\d/, "password needs a digit"),
    confirmPassword: z.string(),
    locale: localeSchema.default("fa"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "passwords do not match",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const bookingSchema = z.object({
  serviceId: cuidLike,
  staffId: cuidLike.optional().or(z.literal("any")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "bad date"),
  slot: z.string().regex(/^\d{13}$/, "bad slot"),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(24),
  email: z.string().email().max(160).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  locale: localeSchema.default("fa"),
  trackingCode: z.string().trim().min(3).max(32).optional().or(z.literal("")),
  locationId: cuidLike.optional().or(z.literal("")),
  /** repeat weekly: 1 = single booking, 2..12 = that many weekly sessions */
  repeatCount: z.coerce.number().int().min(1).max(12).default(1),
  repeatIntervalDays: z.coerce.number().int().min(1).max(90).default(7),
  /** spend one session of a prepaid package instead of paying per visit */
  packagePurchaseId: cuidLike.optional().or(z.literal("")),
});
export type BookingInput = z.infer<typeof bookingSchema>;

export const serviceSchema = z.object({
  id: cuidLike.optional(),
  name: z.string().trim().min(2).max(100),
  nameFa: z.string().trim().max(100).optional().or(z.literal("")),
  shortDesc: z.string().trim().max(160).optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  categoryId: cuidLike.optional().or(z.literal("")),
  durationMin: z.coerce.number().int().min(5).max(480),
  bufferBeforeMin: z.coerce.number().int().min(0).max(120).default(0),
  bufferAfterMin: z.coerce.number().int().min(0).max(120).default(0),
  priceAmount: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
  isPublic: z.coerce.boolean().default(true),
  staffIds: z.array(cuidLike).default([]),
});
export type ServiceInput = z.infer<typeof serviceSchema>;

export const staffSchema = z.object({
  id: cuidLike.optional(),
  name: z.string().trim().min(2).max(80),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  specialty: z.string().trim().max(120).optional().or(z.literal("")),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  phone: z.string().trim().max(24).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
  isBookable: z.coerce.boolean().default(true),
  serviceIds: z.array(cuidLike).default([]),
  workingHours: z
    .array(
      z.object({
        weekday: z.coerce.number().int().min(0).max(6),
        startMinute: z.coerce.number().int().min(0).max(1439),
        endMinute: z.coerce.number().int().min(1).max(1440),
      }),
    )
    .default([]),
});
export type StaffInput = z.infer<typeof staffSchema>;

export const timeOffSchema = z.object({
  staffId: cuidLike,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMinute: z.coerce.number().int().min(0).max(1439),
  endMinute: z.coerce.number().int().min(1).max(1440),
  note: z.string().trim().max(160).optional().or(z.literal("")),
});
export type TimeOffInput = z.infer<typeof timeOffSchema>;

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(160).optional().or(z.literal("")),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

export const settingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  nameFa: z.string().trim().max(80).optional().or(z.literal("")),
  tagline: z.string().trim().max(160).optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase latin"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  timezone: z.string().min(3).max(64),
  weekStart: z.coerce.number().int().min(0).max(6),
  defaultLocale: localeSchema,
  currency: z.string().min(2).max(8),
  phone: z.string().trim().max(24).optional().or(z.literal("")),
  email: z.string().email().max(160).optional().or(z.literal("")),
  address: z.string().trim().max(240).optional().or(z.literal("")),
  minNoticeMinutes: z.coerce.number().int().min(0).max(20_160),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
  slotStepMinutes: z.coerce.number().int().min(5).max(120),
  cancellationWindowHrs: z.coerce.number().int().min(0).max(720),
  allowGuestBooking: z.coerce.boolean(),
  requirePhone: z.coerce.boolean(),
  autoConfirm: z.coerce.boolean(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const appointmentStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const waitlistSchema = z.object({
  serviceId: cuidLike,
  staffId: cuidLike.optional().or(z.literal("")),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(24),
  email: z.string().email().max(160).optional().or(z.literal("")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMinute: z.coerce.number().int().min(0).max(1439).optional(),
  locale: localeSchema.default("fa"),
});
export type WaitlistInput = z.infer<typeof waitlistSchema>;

export const supportSchema = z.object({
  message: z.string().trim().min(5).max(2000),
  locale: localeSchema.default("fa"),
});

export const packageSchema = z.object({
  id: cuidLike.optional(),
  name: z.string().trim().min(2).max(100),
  nameFa: z.string().trim().max(100).optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  priceAmount: z.coerce.number().int().min(0).max(1_000_000_000),
  validDays: z.coerce.number().int().min(1).max(730).default(90),
  isActive: z.coerce.boolean().default(true),
  isPublic: z.coerce.boolean().default(true),
  // "serviceId:quantity" pairs, e.g. "abc:3,def:1"
  lines: z
    .array(
      z.object({
        serviceId: cuidLike,
        quantity: z.coerce.number().int().min(1).max(50),
      }),
    )
    .min(1, "a package needs at least one service"),
});
export type PackageInput = z.infer<typeof packageSchema>;

export const packagePurchaseSchema = z.object({
  packageId: cuidLike,
  customerUserId: cuidLike.optional().or(z.literal("")),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(8).max(24),
  customerEmail: z.string().email().max(160).optional().or(z.literal("")),
  amountPaid: z.coerce.number().int().min(0).max(1_000_000_000),
  locale: localeSchema.default("fa"),
});
export type PackagePurchaseInput = z.infer<typeof packagePurchaseSchema>;

export const locationSchema = z.object({
  id: cuidLike.optional(),
  name: z.string().trim().min(2).max(100),
  nameFa: z.string().trim().max(100).optional().or(z.literal("")),
  address: z.string().trim().max(240).optional().or(z.literal("")),
  phone: z.string().trim().max(24).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
  serviceIds: z.array(cuidLike).default([]),
  staffIds: z.array(cuidLike).default([]),
});
export type LocationInput = z.infer<typeof locationSchema>;

/** Flatten a Zod error into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
