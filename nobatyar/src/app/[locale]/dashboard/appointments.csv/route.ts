import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDictionary, pick } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { formatDate, formatTime } from "@/lib/dates";
import { isLocale, type Locale } from "@/lib/i18n";

/** CSV export of the appointment list (Excel-ready UTF-8 with BOM). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const typed: Locale = isLocale(locale) ? locale : "fa";

  const session = await requireSession(typed);
  void session;

  const workspace = await getWorkspace();
  const t = getDictionary(typed);
  const status = request.nextUrl.searchParams.get("status");

  const rows = await prisma.appointment.findMany({
    where: {
      workspaceId: workspace.id,
      ...(status ? { status } : {}),
    },
    orderBy: { startsAt: "desc" },
    take: 5000,
    include: { service: true, staff: true },
  });

  const header = [
    t.booking.trackingCode,
    t.dashboard.appointments.customer,
    t.common.phone,
    t.dashboard.appointments.service,
    t.dashboard.appointments.staff,
    t.common.date,
    t.common.time,
    t.common.status,
    t.common.price,
    t.common.duration,
  ];

  const escape = (value: string | number | null | undefined) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        escape(row.trackingCode),
        escape(row.customerName),
        escape(row.customerPhone),
        escape(pick(typed, row.service.name, row.service.nameFa)),
        escape(row.staff.name),
        escape(formatDate(row.startsAt, typed, workspace.timezone)),
        escape(formatTime(row.startsAt, typed, workspace.timezone)),
        escape(t.status[row.status as keyof typeof t.status] ?? row.status),
        escape(row.priceAmount ?? 0),
        escape(row.service.durationMin),
      ].join(","),
    ),
  ];

  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="appointments-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
