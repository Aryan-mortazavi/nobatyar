import type { NextRequest } from "next/server";

import { channelError, requireChannel, verifyCustomerToken } from "@/lib/channel-auth";
import { ok, packageView, resolveLocale } from "@/lib/channel-views";
import { activePurchasesFor, remainingFor } from "@/lib/packages";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/packages — the customer's prepaid sessions.
 *
 * A channel that can *see* the remaining quota can also offer it while booking,
 * which is what makes "spend a session from Telegram" feel identical to doing
 * it on the website.
 */
export async function GET(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const customer = await verifyCustomerToken(request);
  if (!customer.ok) return customer.response;

  const workspace = await getWorkspace();
  const locale = resolveLocale(request.nextUrl.searchParams.get("locale"), "fa");
  const t = getDictionary(locale);

  const purchases = await activePurchasesFor(workspace.id, customer.principal.userId);
  const services = new Map(
    (
      await prisma.service.findMany({
        where: { workspaceId: workspace.id, isActive: true },
        select: { id: true, name: true, nameFa: true },
      })
    ).map((service) => [service.id, service]),
  );

  return ok({
    labels: {
      title: t.channel.packagesTitle,
      none: t.channel.noPackages,
      remaining: t.channel.remainingSessions,
    },
    packages: purchases.map((purchase) => ({
      ...packageView(
        {
          id: purchase.id,
          totalSessions: purchase.totalSessions,
          usedSessions: purchase.usedSessions,
          expiresAt: purchase.expiresAt,
          package: { name: purchase.package.name, nameFa: purchase.package.nameFa },
        },
        locale,
      ),
      // per service, because that is the granularity the quota is enforced at
      lines: purchase.package.services.map((line) => {
        const service = services.get(line.serviceId);
        return {
          serviceId: line.serviceId,
          title: service
            ? locale === "fa"
              ? (service.nameFa ?? service.name)
              : service.name
            : line.serviceId,
          quantity: line.quantity,
          remaining: remainingFor(purchase, line.serviceId),
        };
      }),
    })),
  });
}
