import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";

/**
 * Liveness + readiness probe.
 * Returns 503 when the database cannot be reached so a load balancer can act.
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const [appointments, services, locations, packages] = await Promise.all([
      prisma.appointment.count(),
      prisma.service.count(),
      prisma.location.count(),
      prisma.package.count(),
    ]);
    return NextResponse.json(
      {
        status: "ok",
        version: process.env.npm_package_version ?? "1.0.0",
        database: "reachable",
        counts: { appointments, services, locations, packages },
        // which notification transports are configured (never the secrets)
        channels: {
          telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
          whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
        },
        latencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        error: error instanceof Error ? error.message : "unknown",
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
