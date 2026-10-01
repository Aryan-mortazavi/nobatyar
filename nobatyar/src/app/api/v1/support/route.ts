import type { NextRequest } from "next/server";
import { z } from "zod";

import { channelError, requireChannel, verifyCustomerToken } from "@/lib/channel-auth";
import { ok, resolveLocale } from "@/lib/channel-views";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/dictionaries";
import { getWorkspace } from "@/lib/queries";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const supportSchema = z.object({
  message: z.string().trim().min(5).max(2000),
  locale: z.enum(["fa", "en"]).default("fa"),
});

/**
 * POST /api/v1/support — a message from a channel into the same ticket queue the
 * website uses, so the business answers in one place regardless of where the
 * question arrived.
 */
export async function POST(request: NextRequest) {
  const gate = requireChannel(request);
  if (!gate.ok) return gate.response;

  const customer = await verifyCustomerToken(request);
  if (!customer.ok) return customer.response;

  const parsed = supportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return channelError(422, "VALIDATION", "Invalid support message");
  }

  const key = customer.principal.telegramId ?? customer.principal.userId;
  if (!rateLimit(`channel:support:${key}`, 5, 300_000).ok) {
    return channelError(429, "RATE_LIMITED", "Too many support messages");
  }

  const workspace = await getWorkspace();
  const locale = resolveLocale(parsed.data.locale, "fa");
  const t = getDictionary(locale);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: customer.principal.userId },
    select: { id: true, name: true, email: true, phone: true },
  });

  const ticket = await prisma.supportTicket.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      customerName: user.name,
      customerEmail: user.email?.endsWith("@channel.nobatyar.local") ? null : user.email,
      customerPhone: user.phone,
      message: parsed.data.message,
      channel: gate.principal.channel,
      status: "OPEN",
    },
    select: { id: true },
  });

  return ok({
    ticketId: ticket.id,
    message: t.channel.supportSent,
    labels: { supportPrompt: t.channel.supportPrompt, support: t.channel.support },
  });
}
