import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BookingWizard } from "@/components/booking/wizard";
import { getDictionary } from "@/lib/dictionaries";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPublicServices, getPublicStaff, getWorkspace } from "@/lib/queries";
import { civilOf, toJalali } from "@/lib/dates";
import { isLocale, type Locale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return { title: t.booking.title, description: t.booking.subtitle };
}

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ service?: string; staff?: string; location?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  const workspace = await getWorkspace();
  const [serviceRows, staffRows, session, locationRows] = await Promise.all([
    getPublicServices(workspace.id),
    getPublicStaff(workspace.id),
    getSession(),
    prisma.location.findMany({
      where: { workspaceId: workspace.id, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, nameFa: true },
    }),
  ]);

  const services = serviceRows.map((service) => ({
    id: service.id,
    slug: service.slug,
    name: service.name,
    nameFa: service.nameFa,
    shortDesc: service.shortDesc,
    durationMin: service.durationMin,
    priceAmount: service.priceAmount,
    color: service.color,
    categoryId: service.categoryId,
    staffCount: service.staff.length,
  }));

  const staff = staffRows.map((member) => ({
    id: member.id,
    name: member.name,
    slug: member.slug,
    title: member.title,
    specialty: member.specialty,
    photoUrl: member.photoUrl,
    serviceIds: member.services.map((link) => link.serviceId),
  }));

  const user = session
    ? await getUserProfile(session.sub)
    : null;

  return (
    <div className="container-page py-12">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t.booking.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.booking.subtitle}</p>
      </header>

      <BookingWizard
        locale={typed}
        t={t}
        services={services}
        staff={staff}
        today={toJalali(civilOf(new Date(), workspace.timezone))}
        timezone={workspace.timezone}
        currency={workspace.currency}
        weekStart={workspace.weekStart}
        requirePhone={workspace.requirePhone}
        defaultLocale={workspace.defaultLocale as Locale}
        user={user}
        initial={{
          ...(query.service ? { serviceId: query.service } : {}),
          ...(query.staff ? { staffId: query.staff } : {}),
          ...(query.location ? { locationId: query.location } : {}),
        }}
        locations={locationRows}
      />
    </div>
  );
}

async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true },
  });
  return user ? { name: user.name, email: user.email, phone: user.phone } : null;
}
