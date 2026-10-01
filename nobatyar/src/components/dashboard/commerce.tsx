"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";

import {
  deletePackageAction,
  removeLocationAction,
  sellPackageAction,
  saveLocationAction,
  savePackageAction,
} from "@/app/actions/commerce";
import { Badge, EmptyState } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, Tabs } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/i18n";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/utils";
import { initialFormState, type FormState } from "@/lib/form-state";

const ERRORS: Record<string, keyof Dictionary["errors"]> = {
  VALIDATION: "validation",
  IN_USE: "generic",
  NOT_FOUND: "notFound",
};

function useForm(
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
    formAction,
    pending,
    error: state && !state.ok ? t.errors[ERRORS[state.error] ?? "generic"] : null,
    field: (name: string) => (state && !state.ok ? state.fields?.[name] : undefined),
  };
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

// ── Packages ───────────────────────────────────────────────────────────────

type PackageRow = {
  id: string;
  name: string;
  nameFa: string | null;
  description: string | null;
  priceAmount: number;
  validDays: number;
  isActive: boolean;
  isPublic: boolean;
  services: { serviceId: string; quantity: number; service: { name: string; nameFa: string | null } }[];
  sold: number;
};

export function PackagesManager({
  packages,
  purchases,
  services,
  locale,
  t,
  currency,
  timezone,
}: {
  packages: PackageRow[];
  purchases: {
    id: string;
    packageName: string;
    customerName: string;
    totalSessions: number;
    usedSessions: number;
    amountPaid: number;
    expiresAt: Date;
    status: string;
  }[];
  services: { id: string; name: string; nameFa: string | null }[];
  locale: Locale;
  t: Dictionary;
  currency: string;
  timezone: string;
}) {
  const [editing, setEditing] = React.useState<PackageRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [selling, setSelling] = React.useState<PackageRow | null>(null);
  const [tab, setTab] = React.useState("catalog");
  const toast = useToast();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.packages.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.packages.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelling(packages[0] ?? null)} disabled={packages.length === 0}>
            {t.dashboard.packages.sell}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t.dashboard.packages.new}
          </Button>
        </div>
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "catalog", label: t.dashboard.packages.title, count: packages.length },
          { value: "sales", label: t.dashboard.packages.sold, count: purchases.length },
        ]}
      />

      {tab === "catalog" ? (
        packages.length === 0 ? (
          <EmptyState title={t.dashboard.packages.noPackages} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {packages.map((pkg) => (
              <Card key={pkg.id} padding="lg" hover="glow" className="flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {locale === "fa" ? (pkg.nameFa ?? pkg.name) : pkg.name}
                      </h3>
                      {!pkg.isActive ? <Badge tone="outline">off</Badge> : null}
                    </div>
                    <p className="mt-1 text-lg font-bold tabular-nums">
                      {formatMoney(pkg.priceAmount, locale, currency)}
                    </p>
                  </div>
                  <Badge tone="primary">
                    {pkg.services.reduce((sum, line) => sum + line.quantity, 0)}{" "}
                    {t.dashboard.packages.sessions}
                  </Badge>
                </div>

                {pkg.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{pkg.description}</p>
                ) : null}

                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {pkg.services.map((line) => (
                    <li key={line.serviceId} className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        {locale === "fa" ? (line.service.nameFa ?? line.service.name) : line.service.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        ×{formatNumber(line.quantity, locale)}
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-4 text-xs text-muted-foreground">
                  {t.dashboard.packages.validity}: {formatNumber(pkg.validDays, locale)}{" "}
                  {t.common.date} · {t.dashboard.packages.sold}: {formatNumber(pkg.sold, locale)}
                </p>

                <div className="mt-4 flex gap-2 border-t border-border pt-4">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(pkg)}>
                    {t.common.edit}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelling(pkg)}>
                    {t.dashboard.packages.sell}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto text-danger hover:bg-danger/10"
                    aria-label={t.common.delete}
                    onClick={async () => {
                      const result = await deletePackageAction(pkg.id, locale);
                      toast(
                        result.ok
                          ? { tone: "success", title: t.common.success }
                          : { tone: "error", title: t.errors.generic },
                      );
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <Card padding="none">
          {purchases.length === 0 ? (
            <EmptyState title={t.common.noResults} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t.dashboard.packages.customer}</TH>
                  <TH>{t.dashboard.packages.title}</TH>
                  <TH>{t.dashboard.packages.remaining}</TH>
                  <TH>{t.dashboard.packages.amountPaid}</TH>
                  <TH>{t.dashboard.packages.expiresAt}</TH>
                  <TH>{t.common.status}</TH>
                </TR>
              </THead>
              <TBody>
                {purchases.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-medium">{row.customerName}</TD>
                    <TD className="text-muted-foreground">{row.packageName}</TD>
                    <TD className="tabular-nums">
                      {formatNumber(row.totalSessions - row.usedSessions, locale)} /{" "}
                      {formatNumber(row.totalSessions, locale)}
                    </TD>
                    <TD className="tabular-nums">{formatMoney(row.amountPaid, locale, currency)}</TD>
                    <TD className="tabular-nums text-muted-foreground">
                      {formatDate(row.expiresAt, locale, timezone, { dateStyle: "medium" })}
                    </TD>
                    <TD>
                      <Badge tone={row.status === "ACTIVE" ? "success" : "outline"}>
                        {row.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {creating || editing ? (
        <PackageDialog
          pkg={editing}
          services={services}
          locale={locale}
          t={t}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}

      {selling ? (
        <SellDialog
          pkg={selling}
          locale={locale}
          t={t}
          currency={currency}
          onClose={() => setSelling(null)}
        />
      ) : null}
    </div>
  );
}

function PackageDialog({
  pkg,
  services,
  locale,
  t,
  onClose,
}: {
  pkg: PackageRow | null;
  services: { id: string; name: string; nameFa: string | null }[];
  locale: Locale;
  t: Dictionary;
  onClose: () => void;
}) {
  const { formAction, pending, error, field } = useForm(savePackageAction, t, t.common.success);
  const [lines, setLines] = React.useState(
    pkg?.services.map((line) => ({ serviceId: line.serviceId, quantity: line.quantity })) ?? [],
  );

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={pkg ? t.dashboard.packages.editTitle : t.dashboard.packages.new}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="package-form" loading={pending}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form id="package-form" action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {pkg ? <input type="hidden" name="id" value={pkg.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.common.name} required htmlFor="pkg-name" error={field("name")}>
            <Input id="pkg-name" name="name" required defaultValue={pkg?.name} dir="ltr" />
          </Field>
          <Field label={t.dashboard.services.nameFa} htmlFor="pkg-name-fa">
            <Input id="pkg-name-fa" name="nameFa" defaultValue={pkg?.nameFa ?? ""} />
          </Field>
        </div>

        <Field label={t.dashboard.services.description} htmlFor="pkg-desc">
          <Textarea id="pkg-desc" name="description" rows={2} defaultValue={pkg?.description ?? ""} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.common.price} required htmlFor="pkg-price">
            <Input
              id="pkg-price"
              name="priceAmount"
              type="number"
              min={0}
              required
              defaultValue={pkg?.priceAmount ?? 0}
            />
          </Field>
          <Field label={t.dashboard.packages.validity} htmlFor="pkg-valid">
            <Input
              id="pkg-valid"
              name="validDays"
              type="number"
              min={1}
              max={730}
              defaultValue={pkg?.validDays ?? 90}
            />
          </Field>
        </div>

        <Field label={t.dashboard.packages.lines}>
          <ul className="space-y-2">
            {lines.map((line, index) => (
              <li key={index} className="flex items-center gap-2">
                <Select
                  name="serviceId"
                  value={line.serviceId}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, serviceId: event.target.value } : item,
                      ),
                    )
                  }
                  className="h-10 flex-1"
                >
                  <option value="">{t.common.none}</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {locale === "fa" ? (service.nameFa ?? service.name) : service.name}
                    </option>
                  ))}
                </Select>
                <Input
                  name="quantity"
                  type="number"
                  min={1}
                  max={50}
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, quantity: Number(event.target.value) } : item,
                      ),
                    )
                  }
                  className="h-10 w-24"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
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
            onClick={() => setLines((current) => [...current, { serviceId: "", quantity: 1 }])}
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

function SellDialog({
  pkg,
  locale,
  t,
  currency,
  onClose,
}: {
  pkg: PackageRow;
  locale: Locale;
  t: Dictionary;
  currency: string;
  onClose: () => void;
}) {
  const { formAction, pending, error, field } = useForm(sellPackageAction, t, t.common.success);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t.dashboard.packages.sellTitle}
      description={locale === "fa" ? (pkg.nameFa ?? pkg.name) : pkg.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="sell-form" loading={pending}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form id="sell-form" action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="packageId" value={pkg.id} />

        <Field label={t.dashboard.packages.customer} required htmlFor="buy-name">
          <Input id="buy-name" name="customerName" required minLength={2} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.common.phone} required htmlFor="buy-phone">
            <Input id="buy-phone" name="customerPhone" required minLength={8} dir="ltr" />
          </Field>
          <Field label={t.common.email} htmlFor="buy-email">
            <Input id="buy-email" name="customerEmail" type="email" dir="ltr" />
          </Field>
        </div>
        <Field
          label={`${t.dashboard.packages.amountPaid} (${formatMoney(pkg.priceAmount, locale, currency)})`}
          htmlFor="buy-amount"
        >
          <Input
            id="buy-amount"
            name="amountPaid"
            type="number"
            min={0}
            defaultValue={pkg.priceAmount}
            required
          />
        </Field>
        {field("customerUserId") ? (
          <Field label="Account" htmlFor="buy-user" hint="optional">
            <Input id="buy-user" name="customerUserId" />
          </Field>
        ) : null}
        {error ? <FormError message={error} /> : null}
      </form>
    </Dialog>
  );
}

// ── Locations ──────────────────────────────────────────────────────────────

type LocationRow = {
  id: string;
  name: string;
  nameFa: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  serviceIds: string[];
  staffIds: string[];
  appointments: number;
};

export function LocationsManager({
  locations,
  services,
  staff,
  locale,
  t,
}: {
  locations: LocationRow[];
  services: { id: string; name: string; nameFa: string | null }[];
  staff: { id: string; name: string }[];
  locale: Locale;
  t: Dictionary;
}) {
  const [editing, setEditing] = React.useState<LocationRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const toast = useToast();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t.dashboard.locations.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.locations.subtitle}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t.dashboard.locations.new}
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {locations.map((location) => (
          <Card key={location.id} padding="lg" hover="glow">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-semibold">
                    {locale === "fa" ? (location.nameFa ?? location.name) : location.name}
                  </h3>
                  {!location.isActive ? <Badge tone="outline">off</Badge> : null}
                </div>
                {location.address ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{location.address}</p>
                ) : null}
              </div>
              <Badge tone="primary">
                {formatNumber(location.appointments, locale)} {t.dashboard.nav.appointments}
              </Badge>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t.dashboard.locations.staff}: {formatNumber(location.staffIds.length, locale)} ·{" "}
              {t.dashboard.locations.services}: {formatNumber(location.serviceIds.length, locale)}
            </p>
            <div className="mt-4 flex gap-2 border-t border-border pt-4">
              <Button size="sm" variant="ghost" onClick={() => setEditing(location)}>
                {t.common.edit}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ms-auto text-danger hover:bg-danger/10"
                aria-label={t.common.delete}
                onClick={async () => {
                  const result = await removeLocationAction(location.id, locale);
                  toast(
                    result.ok
                      ? { tone: "success", title: t.common.success }
                      : { tone: "error", title: t.errors.generic },
                  );
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {creating || editing ? (
        <LocationDialog
          location={editing}
          services={services}
          staff={staff}
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

function LocationDialog({
  location,
  services,
  staff,
  locale,
  t,
  onClose,
}: {
  location: LocationRow | null;
  services: { id: string; name: string; nameFa: string | null }[];
  staff: { id: string; name: string }[];
  locale: Locale;
  t: Dictionary;
  onClose: () => void;
}) {
  const { formAction, pending, error, field } = useForm(saveLocationAction, t, t.common.success);
  const [serviceIds, setServiceIds] = React.useState(location?.serviceIds ?? []);
  const [staffIds, setStaffIds] = React.useState(location?.staffIds ?? []);

  const toggle = (
    list: string[],
    setList: (value: string[]) => void,
    id: string,
    checked: boolean,
  ) => setList(checked ? [...list, id] : list.filter((item) => item !== id));

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={location ? t.dashboard.locations.editTitle : t.dashboard.locations.new}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="location-form" loading={pending}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form id="location-form" action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {location ? <input type="hidden" name="id" value={location.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.common.name} required htmlFor="loc-name" error={field("name")}>
            <Input id="loc-name" name="name" required defaultValue={location?.name} dir="ltr" />
          </Field>
          <Field label={t.dashboard.services.nameFa} htmlFor="loc-name-fa">
            <Input id="loc-name-fa" name="nameFa" defaultValue={location?.nameFa ?? ""} />
          </Field>
        </div>
        <Field label={t.dashboard.locations.address} htmlFor="loc-address">
          <Input id="loc-address" name="address" defaultValue={location?.address ?? ""} />
        </Field>
        <Field label={t.common.phone} htmlFor="loc-phone">
          <Input id="loc-phone" name="phone" defaultValue={location?.phone ?? ""} dir="ltr" />
        </Field>

        <Field label={t.dashboard.locations.staff}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {staff.map((member) => (
              <li key={member.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <Checkbox
                  id={`loc-staff-${member.id}`}
                  checked={staffIds.includes(member.id)}
                  onCheckedChange={(checked) => toggle(staffIds, setStaffIds, member.id, checked)}
                  ariaLabel={member.name}
                />
                <label htmlFor={`loc-staff-${member.id}`} className="text-sm">
                  {member.name}
                </label>
                {staffIds.includes(member.id) ? (
                  <input type="hidden" name="staffIds" value={member.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </Field>

        <Field label={t.dashboard.locations.services}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {services.map((service) => (
              <li key={service.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <Checkbox
                  id={`loc-svc-${service.id}`}
                  checked={serviceIds.includes(service.id)}
                  onCheckedChange={(checked) => toggle(serviceIds, setServiceIds, service.id, checked)}
                  ariaLabel={service.name}
                />
                <label htmlFor={`loc-svc-${service.id}`} className="text-sm">
                  {locale === "fa" ? (service.nameFa ?? service.name) : service.name}
                </label>
                {serviceIds.includes(service.id) ? (
                  <input type="hidden" name="serviceIds" value={service.id} />
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
