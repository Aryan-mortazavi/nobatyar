/**
 * Packages — prepaid session bundles.
 *
 * A package lists the services it covers and how many sessions of each are
 * included. A customer buys it (recorded as a `PackagePurchase`), and every
 * appointment made with that purchase consumes exactly one session, decremented
 * inside the booking transaction so a session can never be used twice.
 */
import "server-only";
import { cache } from "react";

import { prisma } from "./db";
import { addDays, zonedMinuteToUtc } from "./dates";
import {
  remainingFor,
  remainingForService,
  remainingTotal,
  totalSessionsOf,
  type PurchaseWithPackage,
} from "./packages-plan";

export {
  isPurchaseUsable,
  remainingFor,
  remainingForService,
  remainingTotal,
  totalSessionsOf,
  type PackageLine,
  type PurchaseWithPackage,
} from "./packages-plan";

export const getPublicPackages = cache(async (workspaceId: string) =>
  prisma.package.findMany({
    where: { workspaceId, isActive: true, isPublic: true },
    orderBy: [{ sortOrder: "asc" }, { priceAmount: "asc" }],
    include: {
      services: { include: { service: true } },
      _count: { select: { purchases: true } },
    },
  }),
);

export const getAllPackages = cache(async (workspaceId: string) =>
  prisma.package.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: "asc" }, { priceAmount: "asc" }],
    include: { services: { include: { service: true } }, _count: { select: { purchases: true } } },
  }),
);

/** Active, unexpired purchases of one customer. */
export async function activePurchasesFor(
  workspaceId: string,
  customerUserId: string,
): Promise<PurchaseWithPackage[]> {
  const now = new Date();
  const rows = await prisma.packagePurchase.findMany({
    where: {
      workspaceId,
      customerUserId,
      status: "ACTIVE",
      expiresAt: { gt: now },
    },
    include: { package: { include: { services: { include: { service: true } } } } },
    orderBy: { expiresAt: "asc" },
  });

  // Sessions already spent, per service: the quota is per service, so a
  // customer may mix services inside one bundle.
  const spent = rows.length
    ? await prisma.appointment.groupBy({
        by: ["packagePurchaseId", "serviceId"],
        where: {
          packagePurchaseId: { in: rows.map((row) => row.id) },
          status: { not: "CANCELLED" },
        },
        _count: { _all: true },
      })
    : [];
  const usedByService = new Map<string, number>();
  for (const row of spent) {
    if (!row.packagePurchaseId) continue;
    const key = `${row.packagePurchaseId}:${row.serviceId}`;
    usedByService.set(key, (usedByService.get(key) ?? 0) + row._count._all);
  }

  // `usedSessions < totalSessions` cannot be expressed across two columns
  return rows
    .filter((row) => remainingTotal(row) > 0)
    .map((row) => ({
      id: row.id,
      totalSessions: row.totalSessions,
      usedSessions: row.usedSessions,
      status: row.status,
      expiresAt: row.expiresAt,
      usedByService: Object.fromEntries(
        row.package.services.map((entry) => [
          entry.serviceId,
          usedByService.get(`${row.id}:${entry.serviceId}`) ?? 0,
        ]),
      ),
      package: {
        id: row.package.id,
        name: row.package.name,
        nameFa: row.package.nameFa,
        services: row.package.services.map((entry) => ({
          serviceId: entry.serviceId,
          quantity: entry.quantity,
          service: { name: entry.service.name, nameFa: entry.service.nameFa },
        })),
      },
    }));
}

/**
 * Reserve one session of a purchase (inside the booking transaction).
 * Returns false when the purchase has no session left — the caller then falls
 * back to a normal, pay-at-the-desk booking.
 */
export async function consumeSession(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  purchaseId: string,
  serviceId: string,
): Promise<boolean> {
  const purchase = await tx.packagePurchase.findUnique({
    where: { id: purchaseId },
    include: { package: { include: { services: true } } },
  });
  if (!purchase || purchase.status !== "ACTIVE" || purchase.expiresAt <= new Date()) {
    return false;
  }

  const line = purchase.package.services.find((entry) => entry.serviceId === serviceId);
  if (!line) return false;

  const usedForService = await tx.appointment.count({
    where: { packagePurchaseId: purchase.id, serviceId, status: { not: "CANCELLED" } },
  });
  if (usedForService >= line.quantity) return false;

  await tx.packagePurchase.update({
    where: { id: purchase.id },
    data: { usedSessions: { increment: 1 } },
  });
  return true;
}

/** Record a sale (no online payment: the business collects it offline). */
export async function sellPackage(params: {
  workspaceId: string;
  packageId: string;
  customerUserId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  amountPaid: number;
  purchasedAt?: Date;
}) {
  const pkg = await prisma.package.findUniqueOrThrow({
    where: { id: params.packageId },
    include: { services: true },
  });
  const purchasedAt = params.purchasedAt ?? new Date();
  const expiresAt = addDays(
    { year: purchasedAt.getUTCFullYear(), month: purchasedAt.getUTCMonth() + 1, day: purchasedAt.getUTCDate() },
    pkg.validDays,
  );

  return prisma.packagePurchase.create({
    data: {
      packageId: pkg.id,
      workspaceId: params.workspaceId,
      customerUserId: params.customerUserId ?? null,
      customerName: params.customerName,
      customerEmail: params.customerEmail ?? null,
      customerPhone: params.customerPhone,
      totalSessions: totalSessionsOf(pkg),
      usedSessions: 0,
      amountPaid: params.amountPaid,
      purchasedAt,
      expiresAt: zonedMinuteToUtc(expiresAt, 0, "UTC"),
      status: "ACTIVE",
    },
  });
}
