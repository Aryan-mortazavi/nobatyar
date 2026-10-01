import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LocationsManager } from "@/components/dashboard/commerce";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.locations.title };
}

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typed = locale as Locale;
  const t = getDictionary(typed);

  await requireSession(typed);
  const workspace = await getWorkspace();

  const [locations, services, staff] = await Promise.all([
    prisma.location.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        services: { select: { serviceId: true } },
        staff: { select: { staffId: true } },
        _count: { select: { appointments: true } },
      },
    }),
    prisma.service.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true, nameFa: true },
      orderBy: { name: "asc" },
    }),
    prisma.staffMember.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return (
    <LocationsManager
      locale={typed}
      t={t}
      services={services}
      staff={staff}
      locations={locations.map((location) => ({
        id: location.id,
        name: location.name,
        nameFa: location.nameFa,
        address: location.address,
        phone: location.phone,
        isActive: location.isActive,
        serviceIds: location.services.map((row) => row.serviceId),
        staffIds: location.staff.map((row) => row.staffId),
        appointments: location._count.appointments,
      }))}
    />
  );
}
