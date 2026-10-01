import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PackagesManager } from "@/components/dashboard/commerce";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { isLocale, type Locale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).dashboard.packages.title };
}

export default async function PackagesPage({
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

  const [packages, purchases, services] = await Promise.all([
    prisma.package.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ sortOrder: "asc" }, { priceAmount: "asc" }],
      include: {
        services: { include: { service: true } },
        _count: { select: { purchases: true } },
      },
    }),
    prisma.packagePurchase.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      include: { package: true },
      take: 100,
    }),
    prisma.service.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true, nameFa: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <PackagesManager
      locale={typed}
      t={t}
      currency={workspace.currency}
      timezone={workspace.timezone}
      services={services}
      packages={packages.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        nameFa: pkg.nameFa,
        description: pkg.description,
        priceAmount: pkg.priceAmount,
        validDays: pkg.validDays,
        isActive: pkg.isActive,
        isPublic: pkg.isPublic,
        sold: pkg._count.purchases,
        services: pkg.services.map((line) => ({
          serviceId: line.serviceId,
          quantity: line.quantity,
          service: { name: line.service.name, nameFa: line.service.nameFa },
        })),
      }))}
      purchases={purchases.map((row) => ({
        id: row.id,
        packageName: pick(typed, row.package.name, row.package.nameFa),
        customerName: row.customerName,
        totalSessions: row.totalSessions,
        usedSessions: row.usedSessions,
        amountPaid: row.amountPaid,
        expiresAt: row.expiresAt,
        status: row.status,
      }))}
    />
  );
}
