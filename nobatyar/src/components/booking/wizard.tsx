"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  Copy,
  Sparkles,
  UserRound,
} from "lucide-react";

import {
  fetchDayAction,
  fetchMonthAction,
  type RemoteDay,
  type RemoteSlot,
} from "@/app/actions/availability";
import { bookAppointmentAction, myPackagesAction } from "@/app/actions/booking";
import { BookingCalendar, type DayState, type MonthCursor } from "@/components/booking/calendar";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatTime, toJalali, weekdayLabels, type CivilDate } from "@/lib/dates";
import type { Dictionary } from "@/lib/dictionaries";
import { initialFormState, type FormState } from "@/lib/form-state";
import type { Locale } from "@/lib/i18n";
import { cn, formatMoney, formatNumber } from "@/lib/utils";
import { useActionState } from "react";

type Service = {
  id: string;
  slug: string;
  name: string;
  nameFa: string | null;
  shortDesc: string | null;
  durationMin: number;
  priceAmount: number | null;
  color: string | null;
  categoryId: string | null;
  staffCount: number;
};

type Staff = {
  id: string;
  name: string;
  slug: string;
  title: string | null;
  specialty: string | null;
  photoUrl: string | null;
  serviceIds: string[];
};

type Step = "service" | "staff" | "date" | "details";

const STEP_ORDER: Step[] = ["service", "staff", "date", "details"];

export function BookingWizard({
  locale,
  t,
  services,
  staff,
  today,
  timezone,
  currency,
  weekStart,
  requirePhone,
  defaultLocale,
  user,
  initial,
  locations,
}: {
  locale: Locale;
  t: Dictionary;
  services: Service[];
  staff: Staff[];
  today: CivilDate;
  timezone: string;
  currency: string;
  weekStart: number;
  requirePhone: boolean;
  defaultLocale: Locale;
  user: { name: string; email: string; phone: string | null } | null;
  /** deep link: /book?service=…&staff=… (also used by the per-service QR codes) */
  initial?: { serviceId?: string; staffId?: string; locationId?: string };
  locations?: { id: string; name: string; nameFa: string | null }[];
}) {
  const router = useRouter();
  const toast = useToast();

  // A deep link (QR code, service page, staff page) can skip straight to the
  // calendar — as long as the ids are real and belong to this workspace.
  const deepLink = React.useMemo(() => {
    const service = services.find((item) => item.id === initial?.serviceId);
    if (!service) return null;
    const member = staff.find((item) => item.id === initial?.staffId);
    if (initial?.staffId && (!member || !member.serviceIds.includes(service.id))) {
      return { serviceId: service.id, staffId: "any" as const };
    }
    return { serviceId: service.id, staffId: member ? member.id : ("any" as const) };
  }, [initial?.serviceId, initial?.staffId, services, staff]);

  const [step, setStep] = React.useState<Step>(deepLink ? "date" : "service");
  const [serviceId, setServiceId] = React.useState<string | null>(deepLink?.serviceId ?? null);
  const [staffId, setStaffId] = React.useState<string>(deepLink?.staffId ?? "any");
  const [date, setDate] = React.useState<CivilDate | null>(null);
  const [slot, setSlot] = React.useState<RemoteSlot | null>(null);
  const [cursor, setCursor] = React.useState<MonthCursor>({
    year: today.year,
    month: today.month,
  });

  const [dayStates, setDayStates] = React.useState<Record<string, DayState>>({});
  const [slots, setSlots] = React.useState<RemoteSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [repeatCount, setRepeatCount] = React.useState(1);
  const [locationId, setLocationId] = React.useState(initial?.locationId ?? "");
  const [packageId, setPackageId] = React.useState("");
  const [packages, setPackages] = React.useState<
    { id: string; name: string; remaining: number }[]
  >([]);
  const locationList = locations ?? [];

  // one-time lookup: which package sessions can this customer spend here?
  React.useEffect(() => {
    if (!serviceId || !user) return;
    let cancelled = false;
    void (async () => {
      const result = await myPackagesAction(serviceId);
      if (!cancelled) setPackages(result.purchases);
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, user]);

  const [state, formAction, pending] = useActionState<
    FormState | null,
    FormData
  >(bookAppointmentAction, initialFormState);

  const service = services.find((item) => item.id === serviceId) ?? null;
  const serviceName = service
    ? locale === "fa"
      ? (service.nameFa ?? service.name)
      : service.name
    : "";
  const eligibleStaff = staff.filter(
    (member) => !serviceId || member.serviceIds.includes(serviceId),
  );
  const chosenStaff = staff.find((member) => member.id === staffId) ?? null;

  // ── availability loading ────────────────────────────────────────────────
  React.useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    void (async () => {
      const result = await fetchMonthAction({ serviceId, staffId, locationId });
      if (cancelled || !result.ok) return;
      setDayStates(result.days as Record<string, DayState>);
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, staffId, locationId]);

  React.useEffect(() => {
    if (!serviceId || !date) return;
    let cancelled = false;
    setLoadingSlots(true);
    void (async () => {
      const key = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
      const result = await fetchDayAction({ serviceId, staffId, locationId, date: key });
      if (cancelled) return;
      setSlots(result.ok ? result.slots : []);
      setLoadingSlots(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, staffId, locationId, date]);

  // ── success state ──────────────────────────────────────────────────────
  const bookingCode = state?.ok ? state.trackingCode : undefined;
  const stepIndex = STEP_ORDER.indexOf(step);

  // The step rail hides the steps a deep link already resolved.
  const visibleSteps = STEP_ORDER.filter((candidate) => {
    if (candidate === "service" && deepLink) return false;
    if (candidate === "staff" && deepLink?.staffId && deepLink.staffId !== "any") return false;
    return true;
  });
  const Arrow = locale === "fa" ? ArrowLeft : ArrowRight;
  const BackArrow = locale === "fa" ? ArrowRight : ArrowLeft;

  function goToService() {
    setStep("staff");
  }

  function submitDetails(formEvent: React.FormEvent<HTMLFormElement>) {
    // Service / staff / date / slot travel in hidden inputs, so the native
    // submit already carries everything the server action needs.
    void formEvent;
  }

  if (bookingCode) {
    return (
      <SuccessPanel
        locale={locale}
        t={t}
        code={bookingCode}
        seriesCount={state?.ok ? (state.count ?? 1) : 1}
        serviceName={serviceName}
        date={date}
        slotLabel={slot?.label ?? null}
        timezone={timezone}
        onReset={() => {
          router.refresh();
          setStep("service");
          setServiceId(null);
          setStaffId("any");
          setDate(null);
          setSlot(null);
          setRepeatCount(1);
        }}
        copied={copied}
        onCopy={() => {
          void navigator.clipboard?.writeText(bookingCode);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <StepRail steps={visibleSteps} step={step} t={t} locale={locale} />

      <Card padding="lg" className="min-w-0">
        {step === "service" ? (
          <section className="space-y-5">
            <StepHeading
              title={t.booking.pickService}
              hint={services.length === 0 ? t.booking.noService : undefined}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {services.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setServiceId(item.id);
                    setStaffId("any");
                    setDate(null);
                    setSlot(null);
                    goToService();
                  }}
                  className={cn(
                    "group flex items-start gap-3 rounded-2xl border border-border bg-background/60 p-4 text-start transition",
                    "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg",
                  )}
                >
                  <span
                    className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white"
                    style={{ background: item.color ?? "var(--primary)" }}
                    aria-hidden
                  >
                    {item.durationMin}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {locale === "fa" ? (item.nameFa ?? item.name) : item.name}
                    </span>
                    {item.shortDesc ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {item.shortDesc}
                      </span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="size-3.5" aria-hidden />
                        {item.durationMin} {t.common.minutes}
                      </span>
                      {item.priceAmount ? (
                        <span>{formatMoney(item.priceAmount, locale, currency)}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === "staff" && service ? (
          <section className="space-y-5">
            <StepHeading
              title={t.booking.pickStaff}
              hint={serviceName}
              onBack={() => setStep("service")}
              backLabel={t.common.back}
            />
            {eligibleStaff.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.booking.noStaff}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {eligibleStaff.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStaffId("any");
                      setDate(null);
                      setSlot(null);
                      setStep("date");
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-dashed border-primary/50 bg-primary/5 p-4 text-start transition hover:bg-primary/10"
                  >
                    <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
                      <Sparkles className="size-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-semibold">{t.booking.anyStaff}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t.booking.anyStaffHint}
                      </span>
                    </span>
                  </button>
                ) : null}

                {eligibleStaff.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      setStaffId(member.id);
                      setDate(null);
                      setSlot(null);
                      setStep("date");
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 p-4 text-start transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg"
                  >
                    <Avatar name={member.name} src={member.photoUrl} size={40} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{member.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {member.title ?? member.specialty}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {step === "date" && service ? (
          <section className="space-y-5">
            <StepHeading
              title={`${t.booking.pickDate} · ${t.booking.pickTime}`}
              hint={
                chosenStaff
                  ? `${t.booking.pickStaff}: ${chosenStaff.name}`
                  : t.booking.anyStaff
              }
              onBack={() => setStep("staff")}
              backLabel={t.common.back}
            />

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <BookingCalendar
                locale={locale}
                todayJalali={today}
                selected={date}
                onSelect={(value) => {
                  setDate(value);
                  setSlot(null);
                }}
                dayStates={dayStates}
                weekStart={weekStart}
                cursor={cursor}
                onCursorChange={setCursor}
                labels={{
                  prev: t.common.previous,
                  next: t.common.next,
                  days: weekdayLabels(locale, locale === "fa" ? 6 : 1),
                  free: (count) =>
                    locale === "fa" ? `${count} بازه آزاد` : `${count} free slots`,
                  closed: locale === "fa" ? "بازه آزادی نیست" : "No free slot",
                }}
              />

              <div className="space-y-3">
                {!date ? (
                  <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    {t.booking.pickDate}
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      {formatDate(
                        new Date(`${isoDate(date)}T00:00:00Z`),
                        locale,
                        timezone,
                        { dateStyle: "full" },
                      )}
                    </p>
                    {loadingSlots ? (
                      <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div key={index} className="skeleton h-11 rounded-xl" aria-hidden />
                        ))}
                      </div>
                    ) : slots.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        {t.booking.noSlots}
                      </p>
                    ) : (
                      <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pe-1 sm:grid-cols-4">
                        {slots.map((item) => (
                          <button
                            key={item.start}
                            type="button"
                            disabled={!item.available}
                            onClick={() => {
                              setSlot(item);
                              setStep("details");
                            }}
                            className={cn(
                              "h-11 rounded-xl border text-sm font-medium tabular-nums transition",
                              item.available
                                ? "border-border hover:border-primary hover:bg-primary hover:text-primary-foreground"
                                : "cursor-not-allowed border-dashed text-muted-foreground/40 line-through",
                              slot?.start === item.start && "border-primary bg-primary text-primary-foreground",
                            )}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {step === "details" && service ? (
          <section className="space-y-5">
            <StepHeading
              title={t.booking.detailsTitle}
              hint={`${serviceName} · ${date ? formatDate(new Date(`${isoDate(date)}T00:00:00Z`), locale, timezone, { dateStyle: "medium" }) : ""} · ${slot?.label ?? ""}`}
              onBack={() => setStep("date")}
              backLabel={t.common.back}
            />

            <form action={formAction} className="space-y-4" onSubmit={submitDetails}>
              {/* the wizard state travels with the submit — these inputs must
                  stay *inside* the form or the action never sees them */}
              <input type="hidden" name="serviceId" value={serviceId ?? ""} />
              <input type="hidden" name="staffId" value={staffId} />
              <input type="hidden" name="date" value={date ? isoDate(date) : ""} />
              <input type="hidden" name="slot" value={slot ? String(slot.start) : ""} />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="locationId" value={locationId} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t.common.name}
                  required
                  htmlFor="name"
                  error={state && !state.ok ? state.fields?.name : undefined}
                >
                  <Input
                    id="name"
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={user?.name ?? ""}
                    placeholder={t.booking.namePlaceholder}
                    autoComplete="name"
                  />
                </Field>
                <Field
                  label={t.common.phone}
                  required={requirePhone}
                  htmlFor="phone"
                  error={state && !state.ok ? state.fields?.phone : undefined}
                >
                  <Input
                    id="phone"
                    name="phone"
                    required={requirePhone}
                    minLength={8}
                    maxLength={24}
                    defaultValue={user?.phone ?? ""}
                    placeholder={t.booking.phonePlaceholder}
                    autoComplete="tel"
                    dir="ltr"
                  />
                </Field>
              </div>

              <Field
                label={t.common.email}
                htmlFor="email"
                hint={t.common.optional}
                error={state && !state.ok ? state.fields?.email : undefined}
              >
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={user?.email ?? ""}
                  placeholder={t.booking.emailPlaceholder}
                  autoComplete="email"
                  dir="ltr"
                />
              </Field>

              <Field label={t.dashboard.appointments.customerNote} htmlFor="notes">
                <Textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  maxLength={500}
                  placeholder={t.booking.notesPlaceholder}
                />
              </Field>

              {/* location + package + recurrence, all optional */}
              {locationList.length > 1 ? (
                <Field label={t.booking.location} htmlFor="location-select">
                  <select
                    id="location-select"
                    value={locationId}
                    onChange={(event) => setLocationId(event.target.value)}
                    className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/12"
                  >
                    <option value="">{t.booking.anyLocation}</option>
                    {locationList.map((location) => (
                      <option key={location.id} value={location.id}>
                        {locale === "fa" ? (location.nameFa ?? location.name) : location.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              {packages.length > 0 ? (
                <Field label={t.booking.usePackage} htmlFor="package-select" hint={t.booking.packageSessions}>
                  <select
                    id="package-select"
                    name="packagePurchaseId"
                    value={packageId}
                    onChange={(event) => setPackageId(event.target.value)}
                    className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/12"
                  >
                    <option value="">
                      {locale === "fa" ? "بدون بسته" : "No package"}
                    </option>
                    {packages.map((purchase) => (
                      <option key={purchase.id} value={purchase.id}>
                        {purchase.name} · {purchase.remaining} {t.booking.packageSessions}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <Field label={t.booking.repeat} htmlFor="repeat" hint={t.booking.repeatHint}>
                <div className="flex items-center gap-3">
                  <input
                    type="hidden"
                    name="repeatCount"
                    value={repeatCount}
                    readOnly
                  />
                  <input
                    type="hidden"
                    name="repeatIntervalDays"
                    value={7}
                    readOnly
                  />
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 4, 6, 8, 12].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setRepeatCount(count)}
                        aria-pressed={repeatCount === count}
                        className={cn(
                          "h-10 min-w-12 rounded-xl border px-3 text-sm font-medium tabular-nums transition",
                          repeatCount === count
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:border-primary/50",
                        )}
                      >
                        {count === 1 ? "۱" : formatNumber(count, locale)}
                      </button>
                    ))}
                  </div>
                  {repeatCount > 1 ? (
                    <span className="text-xs text-muted-foreground">
                      {t.booking.everyWeek} {formatNumber(repeatCount, locale)} {t.booking.weeks}
                    </span>
                  ) : null}
                </div>
              </Field>

              {state && !state.ok ? (
                <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
                  {bookingErrorMessage(state, t, locale)}
                </p>
              ) : null}

              <p className="text-xs text-muted-foreground">{t.booking.policyNotice}</p>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                <Button type="button" variant="ghost" onClick={() => setStep("date")}>
                  <BackArrow aria-hidden />
                  {t.common.back}
                </Button>
                <Button type="submit" loading={pending} disabled={!slot}>
                  {pending ? t.booking.submitting : t.booking.submit}
                  <Arrow aria-hidden />
                </Button>
              </div>
            </form>
          </section>
        ) : null}
      </Card>
    </div>
  );
}

function StepHeading({
  title,
  hint,
  onBack,
  backLabel,
}: {
  title: string;
  hint?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden />
          {backLabel}
        </Button>
      ) : null}
    </div>
  );
}

function StepRail({
  steps: stepsProp,
  step,
  t,
  locale,
}: {
  steps: Step[];
  step: Step;
  t: Dictionary;
  locale: Locale;
}) {
  const labels: Record<Step, string> = {
    service: t.booking.step.service,
    staff: t.booking.step.staff,
    date: t.booking.step.date,
    details: t.booking.step.details,
  };
  const steps = stepsProp.map((key) => ({ key, label: labels[key] }));
  const currentIndex = steps.findIndex((item) => item.key === step);

  return (
    <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-3">
      {steps.map((item, index) => {
        const state =
          index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        return (
          <li key={item.key} className="min-w-40 lg:min-w-0">
            <div
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-4 py-3 transition",
                state === "current" && "border-primary/50 bg-primary/8",
                state === "done" && "border-success/30 bg-success/8",
                state === "todo" && "border-border bg-card",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                  state === "current" && "bg-primary text-primary-foreground",
                  state === "done" && "bg-success text-success-foreground",
                  state === "todo" && "bg-muted text-muted-foreground",
                )}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              <span className="text-sm font-medium">{item.label}</span>
            </div>
          </li>
        );
      })}
      <li className="hidden lg:mt-2 lg:block">
        <p className="rounded-2xl border border-dashed border-border p-4 text-xs leading-relaxed text-muted-foreground">
          {locale === "fa"
            ? "در هر مرحله فقط زمان‌های واقعاً آزاد نمایش داده می‌شوند."
            : "Every step only shows slots that are genuinely free."}
        </p>
      </li>
    </ol>
  );
}

/**
 * The action reports which occurrence of a series is gone (`occurrence:3`);
 * telling the customer exactly that is far more useful than "slot taken".
 */
function bookingErrorMessage(
  state: Extract<FormState, { ok: false }>,
  t: Dictionary,
  locale: Locale,
): string {
  const marker = state.fields?.slot;
  if (marker?.startsWith("occurrence:")) {
    const index = Number(marker.split(":")[1]);
    if (Number.isFinite(index)) {
      return t.booking.occurrenceTaken.replace("{n}", formatNumber(index, locale));
    }
  }
  return state.error === "SLOT_TAKEN" ? t.errors.slotTaken : t.errors.generic;
}

function SuccessPanel({
  locale,
  t,
  code,
  seriesCount,
  serviceName,
  date,
  slotLabel,
  timezone,
  onReset,
  onCopy,
  copied,
}: {
  locale: Locale;
  t: Dictionary;
  code: string;
  /** > 1 when a weekly series was booked in one go */
  seriesCount: number;
  serviceName: string;
  date: CivilDate | null;
  slotLabel: string | null;
  timezone: string;
  onReset: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <Card padding="lg" className="mx-auto max-w-xl text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-success/15 text-success">
        <CheckCircle2 className="size-9" aria-hidden />
      </span>
      <h2 className="mt-5 text-2xl font-bold">
        {seriesCount > 1 ? t.booking.seriesCreated : t.booking.successTitle}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{t.booking.successBody}</p>

      {seriesCount > 1 ? (
        <p className="mx-auto mt-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3.5 py-1.5 text-sm font-medium text-primary">
          <CalendarCheck2 className="size-4" aria-hidden />
          {formatNumber(seriesCount, locale)} × {t.booking.everyWeek} {t.booking.weeks}
        </p>
      ) : null}

      <div className="mt-6 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-5">
        <p className="text-xs text-muted-foreground">{t.booking.trackingCode}</p>
        <p className="mt-1 text-2xl font-bold tracking-widest" dir="ltr">
          {code}
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onCopy}>
          <Copy aria-hidden />
          {copied ? t.common.copied : t.common.copy}
        </Button>
      </div>

      <dl className="mt-6 grid gap-3 text-start text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t.dashboard.appointments.service}</dt>
          <dd className="font-medium">{serviceName}</dd>
        </div>
        {date ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t.common.date}</dt>
            <dd className="font-medium">
              {formatDate(new Date(`${isoDate(date)}T00:00:00Z`), locale, timezone, { dateStyle: "long" })}
            </dd>
          </div>
        ) : null}
        {slotLabel ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t.common.time}</dt>
            <dd className="font-medium tabular-nums">{slotLabel}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button onClick={onReset}>
          <CalendarCheck2 aria-hidden />
          {t.booking.another}
        </Button>
        <Button asChild variant="outline">
          <Link href={`/${locale}/dashboard`}>
            <UserRound aria-hidden />
            {t.nav.dashboard}
          </Link>
        </Button>
      </div>

      <p className="mt-5 text-xs text-muted-foreground">{t.features.reminders.body}</p>
      <Badge tone="info" className="mt-3">
        {formatTime(new Date(), locale, timezone)} · {t.booking.trackingCode}
      </Badge>
    </Card>
  );
}

function isoDate(civil: CivilDate): string {
  return `${civil.year}-${String(civil.month).padStart(2, "0")}-${String(civil.day).padStart(2, "0")}`;
}

export { toJalali };
