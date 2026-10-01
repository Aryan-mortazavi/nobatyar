import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClosuresManager, StaffManager } from "@/components/dashboard/managers";
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
  return { title: getDictionary(locale).dashboard.staff.title };
}

export default async function StaffAdminPage({
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

  const [staff, services, holidays, timeOff] = await Promise.all([
    prisma.staffMember.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        workingHours: true,
        services: { select: { serviceId: true } },
        timeOff: { orderBy: { startsAt: "asc" }, take: 5 },
      },
    }),
    prisma.service.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true, nameFa: true },
      orderBy: { name: "asc" },
    }),
    prisma.holiday.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { date: "asc" },
      take: 20,
    }),
    prisma.timeOff.findMany({
      where: { staff: { workspaceId: workspace.id } },
      orderBy: { startsAt: "asc" },
      take: 50,
      include: { staff: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="space-y-10">
      <StaffManager
        locale={typed}
        t={t}
        timezone={workspace.timezone}
        services={services}
        staff={staff.map((member) => ({
          id: member.id,
          name: member.name,
          title: member.title,
          specialty: member.specialty,
          bio: member.bio,
          isActive: member.isActive,
          isBookable: member.isBookable,
          phone: member.phone,
          serviceIds: member.services.map((link) => link.serviceId),
          hours: member.workingHours.map((row) => ({
            weekday: row.weekday,
            startMinute: row.startMinute,
            endMinute: row.endMinute,
          })),
          timeOff: member.timeOff.map((row) => ({
            id: row.id,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            note: row.note,
          })),
        }))}
      />

      <ClosuresManager
        locale={typed}
        t={t}
        timezone={workspace.timezone}
        staff={staff.map((member) => ({ id: member.id, name: member.name }))}
        holidays={holidays.map((row) => ({ id: row.id, date: row.date, note: row.note }))}
        timeOff={timeOff.map((row) => ({
          id: row.id,
          staffId: row.staffId,
          staffName: row.staff.name,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          note: row.note,
        }))}
      />
    </div>
  );
}
