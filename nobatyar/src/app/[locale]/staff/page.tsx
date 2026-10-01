import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Sparkles, UsersRound } from "lucide-react";

import { Badge, EmptyState } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getPublicServices, getPublicStaff, getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";
import { cn, minutesToHHMM } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return { title: t.staff.title, description: t.staff.subtitle };
}

/** 0 = Sunday … 6 = Saturday; ordered by the workspace week start. */
function orderedWeekdays(weekStart: number): number[] {
  return Array.from({ length: 7 }, (_, index) => (weekStart + index) % 7);
}

export default async function StaffPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const workspace = await getWorkspace();
  const [staff, services] = await Promise.all([
    getPublicStaff(workspace.id),
    getPublicServices(workspace.id),
  ]);

  const Arrow = typed === "fa" ? ArrowLeft : ArrowRight;
  const weekdayNames = new Intl.DateTimeFormat(typed === "fa" ? "fa-IR" : "en-GB", {
    weekday: "long",
  });
  const serviceName = new Map(
    services.map((service) => [service.id, pick(typed, service.name, service.nameFa)]),
  );

  return (
    <div className="container-page py-12">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t.staff.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.staff.subtitle}</p>
      </header>

      {staff.length === 0 ? (
        <EmptyState
          icon={<UsersRound className="size-5" aria-hidden />}
          title={t.booking.noStaff}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {staff.map((member) => {
            const byWeekday = new Map<number, { startMinute: number; endMinute: number }[]>();
            for (const window of member.workingHours) {
              byWeekday.set(window.weekday, [
                ...(byWeekday.get(window.weekday) ?? []),
                { startMinute: window.startMinute, endMinute: window.endMinute },
              ]);
            }
            const days = orderedWeekdays(workspace.weekStart);
            // reference date so the weekday name resolves
            const reference = new Date(Date.UTC(2024, 0, 7));

            return (
              <Card key={member.id} padding="lg" hover="lift" className="flex flex-col">
                <div className="flex items-start gap-4">
                  <Avatar name={member.name} src={member.photoUrl} size={56} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{member.name}</h2>
                    <p className="truncate text-sm text-muted-foreground">
                      {member.title ?? member.specialty}
                    </p>
                    {member.specialty ? (
                      <Badge tone="primary" className="mt-2">
                        {member.specialty}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                {member.bio ? (
                  <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {member.bio}
                  </p>
                ) : null}

                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.staff.workingHours}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {days.map((weekday) => {
                      const windows = byWeekday.get(weekday) ?? [];
                      const label = weekdayNames.format(
                        new Date(reference.getTime() + weekday * 86_400_000),
                      );
                      return (
                        <li
                          key={weekday}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-lg px-2 py-1",
                            windows.length === 0 && "text-muted-foreground/50",
                          )}
                        >
                          <span>{label}</span>
                          <span className="tabular-nums">
                            {windows.length === 0
                              ? t.staff.closedDay
                              : windows
                                  .map(
                                    (w) =>
                                      `${minutesToHHMM(w.startMinute)}–${minutesToHHMM(w.endMinute)}`,
                                  )
                                  .join("  ")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {member.services.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {member.services.slice(0, 4).map((link) => (
                      <Badge key={link.serviceId} tone="outline">
                        {serviceName.get(link.serviceId)}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <div className="mt-6 flex gap-2 pt-1">
                  <Button asChild size="sm" className="flex-1">
                    <Link href={`/${typed}/book?staff=${member.id}`}>
                      {t.staff.bookWith}
                      <Arrow aria-hidden />
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/${typed}/services`}>
                      <Sparkles aria-hidden />
                      {t.nav.services}
                    </Link>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}


