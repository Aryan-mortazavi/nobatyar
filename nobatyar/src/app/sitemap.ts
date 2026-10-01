import type { MetadataRoute } from "next";

import { appUrl } from "@/lib/env";
import { locales } from "@/lib/i18n";
import { prisma } from "@/lib/db";

export const revalidate = 3600;

/**
 * Dynamic sitemap: static marketing pages + every public service and staff page.
 * Alternate links tell Google which locales exist for the same content.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPaths = ["", "/services", "/staff", "/pricing", "/faq", "/book"];
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const path of staticPaths) {
      entries.push({
        url: `${appUrl}/${locale}${path}`,
        lastModified: now,
        changeFrequency: path === "" ? "weekly" : "monthly",
        priority: path === "" ? 1 : 0.7,
        alternates: {
          languages: Object.fromEntries(
            locales.map((code) => [code, `${appUrl}/${code}${path}`]),
          ),
        },
      });
    }
  }

  try {
    const workspace = await prisma.workspace.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (workspace) {
      const [services, staff] = await Promise.all([
        prisma.service.findMany({
          where: { workspaceId: workspace.id, isActive: true, isPublic: true },
          select: { slug: true, updatedAt: true },
        }),
        prisma.staffMember.findMany({
          where: { workspaceId: workspace.id, isActive: true, isBookable: true },
          select: { slug: true, updatedAt: true },
        }),
      ]);

      for (const service of services) {
        for (const locale of locales) {
          entries.push({
            url: `${appUrl}/${locale}/services/${service.slug}`,
            lastModified: service.updatedAt,
            changeFrequency: "monthly",
            priority: 0.8,
          });
        }
      }
      for (const member of staff) {
        for (const locale of locales) {
          entries.push({
            url: `${appUrl}/${locale}/staff/${member.slug}`,
            lastModified: member.updatedAt,
            changeFrequency: "monthly",
            priority: 0.6,
          });
        }
      }
    }
  } catch {
    // A missing database must not break the sitemap endpoint.
  }

  return entries;
}
