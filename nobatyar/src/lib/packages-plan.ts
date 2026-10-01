/**
 * Package (prepaid session bundle) rules — pure, no database.
 *
 * Kept apart from `packages.ts` so the arithmetic can be unit tested: the
 * server module owns the queries, this file owns the meaning of a "session".
 */

export type PackageLine = {
  serviceId: string;
  quantity: number;
  service: { name: string; nameFa: string | null };
};

export type PurchaseWithPackage = {
  id: string;
  totalSessions: number;
  usedSessions: number;
  status: string;
  expiresAt: Date;
  /** sessions already spent, keyed by service id */
  usedByService: Record<string, number>;
  package: {
    id: string;
    name: string;
    nameFa: string | null;
    services: PackageLine[];
  };
};

/** Total sessions a package includes (sum of its service quantities). */
export function totalSessionsOf(pkg: { services: { quantity: number }[] }): number {
  return pkg.services.reduce((sum, row) => sum + row.quantity, 0);
}

/**
 * Sessions still spendable on one service.
 *
 * `used` is the number of non-cancelled appointments already paid for with this
 * purchase for that same service — the per-service quota is the authority, so a
 * customer may mix services inside one bundle.
 */
export function remainingForService(
  line: { quantity: number } | undefined,
  used: number,
): number {
  if (!line) return 0;
  return Math.max(0, line.quantity - used);
}

/** Sessions left on the purchase as a whole (what the UI shows). */
export function remainingTotal(purchase: {
  totalSessions: number;
  usedSessions: number;
}): number {
  return Math.max(0, purchase.totalSessions - purchase.usedSessions);
}

/** Is this purchase usable right now? */
export function isPurchaseUsable(
  purchase: { status: string; expiresAt: Date },
  now = new Date(),
): boolean {
  return purchase.status === "ACTIVE" && purchase.expiresAt > now;
}

/** Sessions of one service still spendable on a purchase. */
export function remainingFor(purchase: PurchaseWithPackage, serviceId: string): number {
  const line = purchase.package.services.find((entry) => entry.serviceId === serviceId);
  return remainingForService(line, purchase.usedByService?.[serviceId] ?? 0);
}
