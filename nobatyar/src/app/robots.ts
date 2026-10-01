import type { MetadataRoute } from "next";

import { appUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // the dashboard and the auth screens must never be indexed
        disallow: ["/api/", "/*/dashboard", "/*/login", "/*/register"],
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
    host: appUrl,
  };
}
