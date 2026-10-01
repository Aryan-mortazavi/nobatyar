import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, Clock3, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getCategories, getPublicServices, getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";
import { cn, formatMoney } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return { title: t.services.title, description: t.services.subtitle };
}

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const workspace = await getWorkspace();
  const [services, categories] = await Promise.all([
    getPublicServices(workspace.id),
    getCategories(workspace.id),
  ]);

  const Arrow = typed === "fa" ? ArrowLeft : ArrowRight;
  const byCategory = categories.map((category) => ({
    category,
    items: services.filter((service) => service.categoryId === category.id),
  }));
  const uncategorised = services.filter((service) => !service.categoryId);

  return (
    <div className="container-page py-12">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t.services.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.services.subtitle}</p>
      </header>

      <div className="space-y-14">
        {[...byCategory.filter((group) => group.items.length > 0), ...(uncategorised.length ? [{ category: null, items: uncategorised }] : [])].map(
          (group) => (
            <section key={group.category?.id ?? "none"}>
              <div className="mb-5 flex items-center gap-3">
                <h2 className="text-xl font-semibold tracking-tight">
                  {group.category
                    ? pick(typed, group.category.name, group.category.nameFa)
                    : t.services.title}
                </h2>
                <Badge tone="default">{group.items.length}</Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((service) => (
                  <Card key={service.id} padding="lg" hover="lift" className="flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className="grid size-11 place-items-center rounded-2xl text-sm font-bold text-white"
                        style={{ background: service.color ?? "var(--primary)" }}
                        aria-hidden
                      >
                        {service.durationMin}
                      </span>
                      {service.priceAmount ? (
                        <span className="text-sm font-semibold tabular-nums">
                          {formatMoney(service.priceAmount, typed, workspace.currency)}
                        </span>
                      ) : null}
                    </div>

                    <h3 className="mt-4 font-semibold">{pick(typed, service.name, service.nameFa)}</h3>
                    {service.shortDesc ? (
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                        {service.shortDesc}
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="size-3.5" aria-hidden />
                        {service.durationMin} {t.common.minutes}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-3.5" aria-hidden />
                        {service.staff.length} {t.services.staffCount}
                      </span>
                    </div>

                    <div className="mt-5 flex gap-2 pt-1">
                      <Button asChild size="sm" className="flex-1">
                        <Link href={`/${typed}/book?service=${service.id}`}>
                          {t.services.bookNow}
                          <Arrow aria-hidden />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/${typed}/services/${service.slug}`} aria-label={t.staff.viewProfile}>
                          <ArrowUpRight className="size-4" aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ),
        )}
      </div>

      {services.length === 0 ? (
        <Card padding="lg" className="text-center text-muted-foreground">
          {t.booking.noService}
        </Card>
      ) : null}
    </div>
  );
}
