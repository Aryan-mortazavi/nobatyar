/**
 * Domain constants shared by the UI and the API.
 * Status values match the strings stored in the database.
 */

export const APPOINTMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const STATUS_TONE: Record<AppointmentStatus, string> = {
  PENDING: "bg-warning/15 text-warning border-warning/30",
  CONFIRMED: "bg-success/15 text-success border-success/30",
  COMPLETED: "bg-info/15 text-info border-info/30",
  CANCELLED: "bg-danger/15 text-danger border-danger/30",
  NO_SHOW: "bg-muted text-muted-foreground border-border",
};

export const WAITLIST_STATUSES = ["PENDING", "NOTIFIED", "BOOKED", "EXPIRED", "CANCELLED"] as const;

export const TICKET_STATUSES = ["OPEN", "ANSWERED", "CLOSED"] as const;

export const MEMBER_ROLES = ["OWNER", "ADMIN", "MANAGER", "STAFF"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const TIMEZONES = [
  "Asia/Tehran",
  "UTC",
  "Asia/Dubai",
  "Europe/Istanbul",
  "Europe/London",
  "America/New_York",
  "Asia/Kolkata",
] as const;

export const CURRENCIES = ["IRT", "IRR", "USD", "EUR", "AED", "TRY"] as const;

/** 0 = Sunday … 6 = Saturday */
export const WEEKDAYS_INDEXED = [0, 1, 2, 3, 4, 5, 6] as const;
