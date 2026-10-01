"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";

import {
  deleteServiceAction,
  saveHolidayAction,
  saveServiceAction,
  saveSettingsAction,
  saveStaffAction,
} from "@/app/actions/admin";
import { removeHolidayAction, removeTimeOffAction } from "@/app/actions/admin";
import { Badge, EmptyState } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, Tabs } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/i18n";
import { CURRENCIES, TIMEZONES } from "@/lib/domain";
import { formatMoney, minutesToHHMM } from "@/lib/utils";
import { initialFormState, type FormState } from "@/lib/form-state";

const ERROR_TEXT: Record<string, keyof Dictionary["errors"]> = {
  VALIDATION: "validation",
  IN_USE: "generic",
  NOT_FOUND: "notFound",
  INVALID_TRANSITION: "generic",
};

/** Reusable submit hook: pending state + toast + field errors. */
function useSubmit(
  action: (prev: FormState | null, data: FormData) => Promise<FormState>,
  t: Dictionary,
  successTitle: string,
) {
  const [state, formAction, pending] = useActionState<FormState | null, FormData>(
    action,
    initialFormState,
  );
  const toast = useToast();
  const [seen, setSeen] = React.useState(false);

  React.useEffect(() => {
    if (!state || seen) return;
    setSeen(true);
    if (state.ok) toast({ tone: "success", title: successTitle });
  }, [state, seen, successTitle, toast]);

  return {
    state,
    formAction,
    pending,
    error: state && !state.ok ? t.errors[ERROR_TEXT[state.error] ?? "generic"] : null,
    field: (name: string) => (state && !state.ok ? state.fields?.[name] : undefined),
  };
}

// ── Services ────────────────────────────────────────────────────────────────

type ServiceRow = {
  id: string;
  name: string;
  nameFa: string | null;
  shortDesc: string | null;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  priceAmount: number | null;
  color: string | null;
  isActive: boolean;
  isPublic: boolean;
  categoryId: string | null;
  staffIds: string[];
  bookings: number;
};

export function ServicesManager({
  services,
  staff,
  categories,
  locale,
  t,
  currency,
}: {
  services: ServiceRow[];
  staff: { id: string; name: string }[];
  categories: { id: string; name: string; nameFa: string | null }[];
  locale: Locale;
  t: Dictionary;
  currency: string;
}) {
  const [editing, setEditing] = React.useState<ServiceRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const toast = useToast();

  async function remove(id: string) {
    const result = await deleteServiceAction(id, locale);
    if (result.ok) toast({ tone: "success", title: t.common.success });
    else toast({ tone: "error", title: t.dashboard.services.deleteBlocked });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.services.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.services.subtitle}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t.dashboard.services.new}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {services.length === 0 ? (
          <EmptyState className="md:col-span-2" title={t.common.noResults} />
        ) : (
          services.map((service) => (
            <Card key={service.id} padding="lg" hover="glow">
              <div className="flex items-start gap-3">
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white"
                  style={{ background: service.color ?? "var(--primary)" }}
                  aria-hidden
                >
                  {service.durationMin}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold">
                      {locale === "fa" ? (service.nameFa ?? service.name) : service.name}
                    </h3>
                    {!service.isActive ? <Badge tone="outline">off</Badge> : null}
                    {!service.isPublic ? <Badge tone="warning">private</Badge> : null}
                  </div>
                  {service.shortDesc ? (
                    <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{service.shortDesc}</p>
                  ) : null}
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {service.durationMin} {t.common.minutes}
                    </span>
                    <span>
                      {t.common.price}:{" "}
                      {service.priceAmount ? formatMoney(service.priceAmount, locale, currency) : "—"}
                    </span>
                    <span>
                      {t.dashboard.appointments.customer}: {service.bookings}
                    </span>
                    <span>
                      {t.staff.title}: {service.staffIds.length}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(service)}>
                    {t.common.edit}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:bg-danger/10"
                    onClick={() => remove(service.id)}
                    aria-label={t.common.delete}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {creating || editing ? (
        <ServiceDialog
          service={editing}
          staff={staff}
          categories={categories}
          locale={locale}
          t={t}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ServiceDialog({
  service,
  staff,
  categories,
  locale,
  t,
  onClose,
}: {
  service: ServiceRow | null;
  staff: { id: string; name: string }[];
  categories: { id: string; name: string; nameFa: string | null }[];
  locale: Locale;
  t: Dictionary;
  onClose: () => void;
}) {
  const { formAction, pending, error, field } = useSubmit(
    saveServiceAction,
    t,
    t.common.success,
  );
  const [selected, setSelected] = React.useState<string[]>(service?.staffIds ?? []);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={service ? t.dashboard.services.editTitle : t.dashboard.services.new}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="service-form" loading={pending}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form id="service-form" action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {service ? <input type="hidden" name="id" value={service.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.dashboard.services.nameEn} required htmlFor="name" error={field("name")}>
            <Input id="name" name="name" required defaultValue={service?.name} dir="ltr" />
          </Field>
          <Field label={t.dashboard.services.nameFa} htmlFor="nameFa">
            <Input id="nameFa" name="nameFa" defaultValue={service?.nameFa ?? ""} />
          </Field>
        </div>

        <Field label={t.dashboard.services.description} htmlFor="shortDesc">
          <Input id="shortDesc" name="shortDesc" defaultValue={service?.shortDesc ?? ""} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={t.dashboard.services.durationMin} required htmlFor="durationMin">
            <Input
              id="durationMin"
              name="durationMin"
              type="number"
              min={5}
              max={480}
              step={5}
              required
              defaultValue={service?.durationMin ?? 30}
            />
          </Field>
          <Field label={t.dashboard.services.bufferBefore} htmlFor="bufferBeforeMin">
            <Input
              id="bufferBeforeMin"
              name="bufferBeforeMin"
              type="number"
              min={0}
              max={120}
              step={5}
              defaultValue={service?.bufferBeforeMin ?? 0}
            />
          </Field>
          <Field label={t.dashboard.services.bufferAfter} htmlFor="bufferAfterMin">
            <Input
              id="bufferAfterMin"
              name="bufferAfterMin"
              type="number"
              min={0}
              max={120}
              step={5}
              defaultValue={service?.bufferAfterMin ?? 0}
            />
          </Field>
          <Field label={t.dashboard.services.priceAmount} htmlFor="priceAmount">
            <Input
              id="priceAmount"
              name="priceAmount"
              type="number"
              min={0}
              defaultValue={service?.priceAmount ?? ""}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t.dashboard.services.category} htmlFor="categoryId">
            <Select id="categoryId" name="categoryId" defaultValue={service?.categoryId ?? ""}>
              <option value="">{t.common.none}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {locale === "fa" ? (category.nameFa ?? category.name) : category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.dashboard.settings.accentColor} htmlFor="color">
            <Input id="color" name="color" type="color" defaultValue={service?.color ?? "#7c3aed"} className="h-11 p-1" />
          </Field>
          <div className="flex items-end gap-4 pb-2">
            <Flag name="isActive" label={t.dashboard.services.isActive} defaultOn={service?.isActive ?? true} />
            <Flag name="isPublic" label={t.dashboard.services.isPublic} defaultOn={service?.isPublic ?? true} />
          </div>
        </div>

        <Field label={t.dashboard.services.assignStaff}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {staff.map((member) => (
              <li key={member.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <Checkbox
                  id={`staff-${member.id}`}
                  checked={selected.includes(member.id)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, member.id]
                        : current.filter((id) => id !== member.id),
                    )
                  }
                  ariaLabel={member.name}
                />
                <label htmlFor={`staff-${member.id}`} className="text-sm">
                  {member.name}
                </label>
                {selected.includes(member.id) ? (
                  <input type="hidden" name="staffIds" value={member.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </Field>

        {error ? <FormError message={error} /> : null}
      </form>
    </Dialog>
  );
}

// ── Staff ───────────────────────────────────────────────────────────────────

type StaffRow = {
  id: string;
  name: string;
  title: string | null;
  specialty: string | null;
  bio: string | null;
  isActive: boolean;
  isBookable: boolean;
  phone: string | null;
  serviceIds: string[];
  hours: { weekday: number; startMinute: number; endMinute: number }[];
  timeOff: { id: string; startsAt: Date; endsAt: Date; note: string | null }[];
};

export function StaffManager({
  staff,
  services,
  locale,
  t,
  timezone,
}: {
  staff: StaffRow[];
  services: { id: string; name: string; nameFa: string | null }[];
  locale: Locale;
  t: Dictionary;
  timezone: string;
}) {
  const [editing, setEditing] = React.useState<StaffRow | null>(null);
  const [creating, setCreating] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.staff.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.staff.subtitle}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t.dashboard.staff.new}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {staff.map((member) => (
          <Card key={member.id} padding="lg" hover="glow">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-semibold">{member.name}</h3>
                  {!member.isActive ? <Badge tone="outline">off</Badge> : null}
                  {!member.isBookable ? <Badge tone="warning">—</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{member.title ?? member.specialty}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.dashboard.staff.workingHours}: {member.hours.length} · {t.dashboard.staff.services}:{" "}
                  {member.serviceIds.length}
                </p>
                {member.timeOff.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {member.timeOff.slice(0, 3).map((entry) => (
                      <li key={entry.id}>
                        ⛔ {formatDate(entry.startsAt, locale, timezone, { dateStyle: "medium" })} ·{" "}
                        {minutesToHHMM(entry.startsAt.getUTCHours() * 60 + entry.startsAt.getUTCMinutes())}
                        {entry.note ? ` — ${entry.note}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(member)}>
                {t.common.edit}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {creating || editing ? (
        <StaffDialog
          member={editing}
          services={services}
          locale={locale}
          t={t}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function StaffDialog({
  member,
  services,
  locale,
  t,
  onClose,
}: {
  member: StaffRow | null;
  services: { id: string; name: string; nameFa: string | null }[];
  locale: Locale;
  t: Dictionary;
  onClose: () => void;
}) {
  const { formAction, pending, error, field } = useSubmit(saveStaffAction, t, t.common.success);
  const [selected, setSelected] = React.useState<string[]>(member?.serviceIds ?? []);
  const [rows, setRows] = React.useState(
    (member?.hours ?? []).map((row) => ({ ...row })),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={member ? t.dashboard.staff.editTitle : t.dashboard.staff.new}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="staff-form" loading={pending}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form id="staff-form" action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {member ? <input type="hidden" name="id" value={member.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.common.name} required htmlFor="name" error={field("name")}>
            <Input id="name" name="name" required defaultValue={member?.name} />
          </Field>
          <Field label={t.dashboard.staff.role} htmlFor="title">
            <Input id="title" name="title" defaultValue={member?.title ?? ""} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.dashboard.staff.specialty} htmlFor="specialty">
            <Input id="specialty" name="specialty" defaultValue={member?.specialty ?? ""} />
          </Field>
          <Field label={t.common.phone} htmlFor="phone">
            <Input id="phone" name="phone" defaultValue={member?.phone ?? ""} dir="ltr" />
          </Field>
        </div>

        <Field label={t.dashboard.staff.bio} htmlFor="bio">
          <Textarea id="bio" name="bio" rows={3} defaultValue={member?.bio ?? ""} />
        </Field>

        <div className="flex items-center gap-6">
          <Flag name="isActive" label={t.dashboard.services.isActive} defaultOn={member?.isActive ?? true} />
          <Flag name="isBookable" label={t.dashboard.staff.isBookable} defaultOn={member?.isBookable ?? true} />
        </div>

        <Field label={t.dashboard.staff.services}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {services.map((service) => (
              <li key={service.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <Checkbox
                  id={`svc-${service.id}`}
                  checked={selected.includes(service.id)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, service.id]
                        : current.filter((id) => id !== service.id),
                    )
                  }
                  ariaLabel={service.name}
                />
                <label htmlFor={`svc-${service.id}`} className="text-sm">
                  {locale === "fa" ? (service.nameFa ?? service.name) : service.name}
                </label>
                {selected.includes(service.id) ? (
                  <input type="hidden" name="serviceIds" value={service.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </Field>

        <Field label={t.dashboard.staff.workingHours}>
          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  name="weekday"
                  value={String(row.weekday)}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, weekday: Number(event.target.value) } : item,
                      ),
                    )
                  }
                  className="h-9 w-36"
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                    <option key={day} value={day}>
                      {new Intl.DateTimeFormat("en-GB", {
                        weekday: "long",
                        timeZone: "UTC",
                      }).format(new Date(Date.UTC(2024, 0, 7 + day)))}
                    </option>
                  ))}
                </Select>
                <Input
                  name="startMinute"
                  type="number"
                  min={0}
                  max={1439}
                  step={15}
                  value={row.startMinute}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, startMinute: Number(event.target.value) } : item,
                      ),
                    )
                  }
                  className="h-9 w-24"
                />
                <Input
                  name="endMinute"
                  type="number"
                  min={1}
                  max={1440}
                  step={15}
                  value={row.endMinute}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, endMinute: Number(event.target.value) } : item,
                      ),
                    )
                  }
                  className="h-9 w-24"
                />
                <span className="text-xs text-muted-foreground">
                  {minutesToHHMM(row.startMinute)}–{minutesToHHMM(row.endMinute)}
                </span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  aria-label={t.common.delete}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() =>
              setRows((current) => [...current, { weekday: 6, startMinute: 540, endMinute: 1080 }])
            }
          >
            <Plus aria-hidden />
            {t.common.create}
          </Button>
        </Field>

        {error ? <FormError message={error} /> : null}
      </form>
    </Dialog>
  );
}

// ── Time off & holidays ─────────────────────────────────────────────────────

export function ClosuresManager({
  staff,
  holidays,
  timeOff,
  locale,
  t,
  timezone,
}: {
  staff: { id: string; name: string }[];
  holidays: { id: string; date: Date; note: string | null }[];
  timeOff: { id: string; staffId: string; staffName: string; startsAt: Date; endsAt: Date; note: string | null }[];
  locale: Locale;
  t: Dictionary;
  timezone: string;
}) {
  const holiday = useSubmit(saveHolidayAction, t, t.common.success);
  const timeOffForm = useSubmit(
    async (_prev, data) => {
      const { addTimeOffAction } = await import("@/app/actions/admin");
      return addTimeOffAction(_prev, data);
    },
    t,
    t.common.success,
  );
  const toast = useToast();
  const staffName = new Map(staff.map((member) => [member.id, member.name]));

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.staff.timeOff}</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg">
          <h3 className="font-semibold">{t.dashboard.staff.addTimeOff}</h3>
          <form action={timeOffForm.formAction} className="mt-4 space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <Field label={t.dashboard.appointments.staff} htmlFor="staffId">
              <Select id="staffId" name="staffId" required>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.common.date} htmlFor="timeoff-date" required>
              <Input id="timeoff-date" name="date" type="date" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.dashboard.staff.from} htmlFor="timeoff-from">
                <Input
                  id="timeoff-from"
                  name="startMinute"
                  type="number"
                  min={0}
                  max={1439}
                  step={15}
                  defaultValue={540}
                />
              </Field>
              <Field label={t.dashboard.staff.to} htmlFor="timeoff-to">
                <Input
                  id="timeoff-to"
                  name="endMinute"
                  type="number"
                  min={1}
                  max={1440}
                  step={15}
                  defaultValue={780}
                />
              </Field>
            </div>
            <Field label={t.dashboard.staff.timeOffNote} htmlFor="timeoff-note">
              <Input id="timeoff-note" name="note" />
            </Field>
            {timeOffForm.error ? <FormError message={timeOffForm.error} /> : null}
            <Button type="submit" loading={timeOffForm.pending} block>
              {t.common.create}
            </Button>
          </form>
        </Card>

        <Card padding="lg">
          <h3 className="font-semibold">{t.common.date}</h3>
          <form action={holiday.formAction} className="mt-4 space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <Field label={t.common.date} htmlFor="holiday-date" required>
              <Input id="holiday-date" name="date" type="date" required />
            </Field>
            <Field label={t.dashboard.staff.timeOffNote} htmlFor="holiday-note">
              <Input id="holiday-note" name="note" />
            </Field>
            {holiday.error ? <FormError message={holiday.error} /> : null}
            <Button type="submit" loading={holiday.pending} block>
              {t.common.create}
            </Button>
          </form>

          {holidays.length > 0 ? (
            <ul className="mt-5 space-y-2 border-t border-border pt-4">
              {holidays.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="tabular-nums">
                    {formatDate(row.date, locale, timezone, { dateStyle: "medium" })}
                    {row.note ? ` — ${row.note}` : ""}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={async () => {
                      const result = await removeHolidayAction(row.id, locale);
                      if (result.ok) toast({ tone: "success", title: t.common.success });
                    }}
                    aria-label={t.common.delete}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      <Card padding="lg">
        <h3 className="font-semibold">{t.dashboard.staff.timeOff}</h3>
        {timeOff.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t.common.noResults}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {timeOff.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">{staffName.get(row.staffId) ?? "—"}</span>
                  <span className="ms-2 tabular-nums text-muted-foreground">
                    {formatDate(row.startsAt, locale, timezone, { dateStyle: "medium" })}
                  </span>
                  {row.note ? <span className="ms-2 text-muted-foreground">— {row.note}</span> : null}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={async () => {
                    const result = await removeTimeOffAction(row.id, locale);
                    if (result.ok) toast({ tone: "success", title: t.common.success });
                  }}
                  aria-label={t.common.delete}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

export type SettingsRow = {
  name: string;
  nameFa: string | null;
  tagline: string | null;
  description: string | null;
  slug: string;
  accentColor: string;
  timezone: string;
  weekStart: number;
  defaultLocale: string;
  currency: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  slotStepMinutes: number;
  cancellationWindowHrs: number;
  allowGuestBooking: boolean;
  requirePhone: boolean;
  autoConfirm: boolean;
};

export function SettingsForm({
  settings,
  locale,
  t,
}: {
  settings: SettingsRow;
  locale: Locale;
  t: Dictionary;
}) {
  const { formAction, pending, error, field } = useSubmit(saveSettingsAction, t, t.dashboard.settings.saved);
  const [tab, setTab] = React.useState("profile");

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "profile", label: t.dashboard.settings.profile },
          { value: "policy", label: t.dashboard.settings.policy },
        ]}
      />

      {tab === "profile" ? (
        <Card padding="lg" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.dashboard.settings.workspaceName} required htmlFor="name" error={field("name")}>
              <Input id="name" name="name" required defaultValue={settings.name} dir="ltr" />
            </Field>
            <Field label={t.dashboard.settings.workspaceNameFa} htmlFor="nameFa">
              <Input id="nameFa" name="nameFa" defaultValue={settings.nameFa ?? ""} />
            </Field>
            <Field label={t.dashboard.settings.tagline} htmlFor="tagline">
              <Input id="tagline" name="tagline" defaultValue={settings.tagline ?? ""} />
            </Field>
            <Field label={t.dashboard.settings.slug} htmlFor="slug" error={field("slug")}>
              <Input id="slug" name="slug" required defaultValue={settings.slug} dir="ltr" />
            </Field>
          </div>
          <Field label={t.dashboard.settings.description} htmlFor="description">
            <Textarea id="description" name="description" rows={3} defaultValue={settings.description ?? ""} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={t.common.phone} htmlFor="phone">
              <Input id="phone" name="phone" defaultValue={settings.phone ?? ""} dir="ltr" />
            </Field>
            <Field label={t.common.email} htmlFor="email">
              <Input id="email" name="email" type="email" defaultValue={settings.email ?? ""} dir="ltr" />
            </Field>
            <Field label={t.dashboard.settings.timezone} htmlFor="timezone">
              <Select id="timezone" name="timezone" defaultValue={settings.timezone}>
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.dashboard.settings.currency} htmlFor="currency">
              <Select id="currency" name="currency" defaultValue={settings.currency}>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t.dashboard.settings.weekStart} htmlFor="weekStart">
              <Select id="weekStart" name="weekStart" defaultValue={String(settings.weekStart)}>
                {[0, 1, 6].map((day) => (
                  <option key={day} value={day}>
                    {new Intl.DateTimeFormat("en-GB", {
                      weekday: "long",
                      timeZone: "UTC",
                    }).format(new Date(Date.UTC(2024, 0, 7 + day)))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.dashboard.settings.locale} htmlFor="defaultLocale">
              <Select id="defaultLocale" name="defaultLocale" defaultValue={settings.defaultLocale}>
                <option value="fa">فارسی</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label={t.dashboard.settings.accentColor} htmlFor="accentColor">
              <Input
                id="accentColor"
                name="accentColor"
                type="color"
                defaultValue={settings.accentColor}
                className="h-11 p-1"
              />
            </Field>
          </div>
        </Card>
      ) : (
        <Card padding="lg" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t.dashboard.settings.minNoticeMinutes} htmlFor="minNoticeMinutes">
              <Input
                id="minNoticeMinutes"
                name="minNoticeMinutes"
                type="number"
                min={0}
                max={20160}
                step={30}
                defaultValue={settings.minNoticeMinutes}
              />
            </Field>
            <Field label={t.dashboard.settings.maxAdvanceDays} htmlFor="maxAdvanceDays">
              <Input
                id="maxAdvanceDays"
                name="maxAdvanceDays"
                type="number"
                min={1}
                max={365}
                defaultValue={settings.maxAdvanceDays}
              />
            </Field>
            <Field label={t.dashboard.settings.slotStepMinutes} htmlFor="slotStepMinutes">
              <Select id="slotStepMinutes" name="slotStepMinutes" defaultValue={String(settings.slotStepMinutes)}>
                {[5, 10, 15, 20, 30, 60].map((step) => (
                  <option key={step} value={step}>
                    {step}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.dashboard.settings.cancellationWindowHrs} htmlFor="cancellationWindowHrs">
              <Input
                id="cancellationWindowHrs"
                name="cancellationWindowHrs"
                type="number"
                min={0}
                max={720}
                defaultValue={settings.cancellationWindowHrs}
              />
            </Field>
          </div>

          <div className="space-y-3">
            {[
              { name: "allowGuestBooking", label: t.dashboard.settings.allowGuestBooking, value: settings.allowGuestBooking },
              { name: "requirePhone", label: t.dashboard.settings.requirePhone, value: settings.requirePhone },
              { name: "autoConfirm", label: t.dashboard.settings.autoConfirm, value: settings.autoConfirm },
            ].map((row) => (
              <label
                key={row.name}
                htmlFor={row.name}
                className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3"
              >
                <span className="text-sm">{row.label}</span>
                <Checkbox
                  id={row.name}
                  name={row.name}
                  checked={row.value}
                  onCheckedChange={() => undefined}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t.dashboard.settings.policyHint}</p>
        </Card>
      )}

      {error ? <FormError message={error} /> : null}

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          {t.common.save}
        </Button>
      </div>
    </form>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/**
 * Boolean toggle that also posts its state with the surrounding form.
 * The native checkbox is visually hidden but keeps keyboard + form semantics.
 */
function Flag({
  name,
  label,
  defaultOn,
}: {
  name: string;
  label: string;
  defaultOn: boolean;
}) {
  const [on, setOn] = React.useState(defaultOn);
  return (
    <label htmlFor={name} className="flex items-center gap-2 text-sm">
      <Checkbox
        id={name}
        name={name}
        checked={on}
        onCheckedChange={setOn}
        ariaLabel={label}
      />
      {label}
    </label>
  );
}
