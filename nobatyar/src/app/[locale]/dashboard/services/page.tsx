import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ServicesManager } from "@/components/dashboard/managers";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { getCategories, getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.services.title };
}

export default async function ServicesAdminPage({
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

  const [services, staff, categories] = await Promise.all([
    prisma.service.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        staff: { select: { staffId: true } },
        _count: { select: { appointments: true } },
      },
    }),
    prisma.staffMember.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    getCategories(workspace.id),
  ]);

  return (
    <ServicesManager
      locale={typed}
      t={t}
      currency={workspace.currency}
      categories={categories.map((category) => ({
        id: category.id,
        name: category.name,
        nameFa: category.nameFa,
      }))}
      staff={staff}
      services={services.map((service) => ({
        id: service.id,
        name: service.name,
        nameFa: service.nameFa,
        shortDesc: service.shortDesc,
        durationMin: service.durationMin,
        bufferBeforeMin: service.bufferBeforeMin,
        bufferAfterMin: service.bufferAfterMin,
        priceAmount: service.priceAmount,
        color: service.color,
        isActive: service.isActive,
        isPublic: service.isPublic,
        categoryId: service.categoryId,
        staffIds: service.staff.map((link) => link.staffId),
        bookings: service._count.appointments,
      }))}
    />
  );
}
