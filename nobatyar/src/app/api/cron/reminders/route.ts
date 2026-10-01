import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { runReminderSweep } from "@/lib/notifications";

/**
 * Reminder sweep — call it from Vercel Cron, a GitHub Action or any scheduler.
 *
 *   GET /api/cron/reminders
 *   Authorization: Bearer $CRON_SECRET
 *
 * Safe to call repeatedly: `reminded24hAt` / `reminded1hAt` guarantee that
 * each reminder is delivered exactly once.
 */
function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // dev: open
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReminderSweep();
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}
