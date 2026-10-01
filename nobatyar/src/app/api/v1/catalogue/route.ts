import type { NextRequest } from "next/server";

import { requireChannel, channelError } from "@/lib/channel-auth";
import {
  locationView,
  ok,
  resolveLocale,
  serviceView,
  staffView,
} from "@/lib/channel-views";
import { getDictionary, pick } from "@/lib/dictionaries";
import { prisma } from "@/lib/db";
import { getPublicServices, getPublicStaff, getWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/catalogue — everything a channel needs to render its menu.
 *
 * Deliberately one call: a Telegram user waiting on six sequential requests
 * sees a spinner instead of a menu. Optional `?locale=fa|en` decides the
 * wording; `name`/`nameFa` are always both returned so a channel can switch
 * language later without another round trip.
 */
export async function GET(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const workspace = await getWorkspace();
  const locale = resolveLocale(request.nextUrl.searchParams.get("locale"), workspace.defaultLocale);
  const t = getDictionary(locale);

  const [services, staff, locations] = await Promise.all([
    getPublicServices(workspace.id),
    getPublicStaff(workspace.id),
    prisma.location.findMany({
      where: { workspaceId: workspace.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return ok({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      nameFa: workspace.nameFa,
      title: pick(locale, workspace.name, workspace.nameFa),
      tagline: workspace.tagline,
      phone: workspace.phone,
      address: workspace.address ?? null,
      timezone: workspace.timezone,
      currency: workspace.currency,
      locale,
      weekStart: workspace.weekStart,
    },
    labels: {
      menu: t.channel.menu,
      book: t.channel.book,
      myAppointments: t.channel.myAppointments,
      myPackages: t.channel.myPackages,
      support: t.channel.support,
      website: t.channel.website,
      viewOnWeb: t.channel.viewOnWeb,
      back: t.channel.back,
      next: t.channel.next,
      previous: t.channel.previous,
      today: t.channel.today,
      tomorrow: t.channel.tomorrow,
      pickService: t.channel.pickService,
      pickStaff: t.channel.pickStaff,
      anyStaff: t.channel.anyStaff,
      pickDate: t.channel.pickDate,
      pickTime: t.channel.pickTime,
      pickLocation: t.channel.pickLocation,
      noFreeSlot: t.channel.noFreeSlot,
      askName: t.channel.askName,
      askPhone: t.channel.askPhone,
      badPhone: t.channel.badPhone,
      needName: t.channel.needName,
      confirmPrompt: t.channel.confirmPrompt,
      confirmed: t.channel.confirmed,
      cancelled: t.channel.cancelled,
      cancelConfirm: t.channel.cancelConfirm,
      noAppointments: t.channel.noAppointments,
      noPackages: t.channel.noPackages,
      packagesTitle: t.channel.packagesTitle,
      remainingSessions: t.channel.remainingSessions,
      supportPrompt: t.channel.supportPrompt,
      supportSent: t.channel.supportSent,
      error: t.channel.error,
      slotTaken: t.channel.slotTaken,
      notLinked: t.channel.notLinked,
    },
    services: services.map((service) =>
      serviceView(
        {
          id: service.id,
          slug: service.slug,
          name: service.name,
          nameFa: service.nameFa,
          shortDesc: service.shortDesc,
          durationMin: service.durationMin,
          priceAmount: service.priceAmount,
          color: service.color,
          staff: service.staff.map((link) => ({ staffId: link.staffId })),
          category: service.category,
        },
        locale,
      ),
    ),
    staff: staff.map((member) =>
      staffView(
        {
          id: member.id,
          slug: member.slug,
          name: member.name,
          title: member.title,
          bio: member.bio,
          photoUrl: member.photoUrl,
          serviceIds: member.services.map((link) => link.serviceId),
        },
        locale,
      ),
    ),
    locations: locations.map((location) => locationView(location, locale)),
  });
}
