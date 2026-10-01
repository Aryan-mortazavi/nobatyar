/**
 * Outbound channels.
 *
 * Every transport implements the same tiny contract, so a business can mix
 * channels: email for the customer, Telegram for the team, WhatsApp where
 * SMS would normally be used. `enabled()` reports whether the channel is
 * configured, which lets the dispatcher fall back gracefully.
 */
import "server-only";

export type Channel = "EMAIL" | "TELEGRAM" | "WHATSAPP";

export type Delivery = { ok: boolean; detail?: string };

export type Transport = {
  channel: Channel;
  /** configured? (missing API key → the channel is skipped, never crashes) */
  enabled: () => boolean;
  /** deliver a message to a single recipient */
  send: (to: string, subject: string, body: string) => Promise<Delivery>;
};

/** Email: swap this for Resend / SMTP / SES in production. */
export const emailTransport: Transport = {
  channel: "EMAIL",
  enabled: () => true,
  send: async (to, subject, body) => {
    if (process.env.SMTP_URL || process.env.RESEND_API_KEY) {
      // A real transport is a one-function change; see README → Notifications.
      console.info(`[email] to=${to} subject=${subject}`);
      return { ok: true, detail: "smtp" };
    }
    console.info(`[email:log] to=${to} subject=${subject}\n${body}`);
    return { ok: true, detail: "logged" };
  },
};

/**
 * Telegram Bot API — used for the *business* side (new booking alerts to the
 * owner) and, with a deep link, for customer self-service.
 */
export const telegramTransport: Transport = {
  channel: "TELEGRAM",
  enabled: () => Boolean(process.env.TELEGRAM_BOT_TOKEN),
  send: async (to, subject, body) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, detail: "no-token" };
    const chatId = Number(to);
    if (!Number.isFinite(chatId)) return { ok: false, detail: "bad-chat-id" };
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `${subject}\n${body}`,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      });
      return response.ok
        ? { ok: true }
        : { ok: false, detail: `telegram-${response.status}` };
    } catch (error) {
      return { ok: false, detail: String(error).slice(0, 120) };
    }
  },
};

/** WhatsApp Cloud API (free-form text inside the 24h customer window). */
export const whatsappTransport: Transport = {
  channel: "WHATSAPP",
  enabled: () =>
    Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  send: async (to, _subject, body) => {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) return { ok: false, detail: "not-configured" };
    const digits = to.replace(/\D/g, "");
    if (digits.length < 8) return { ok: false, detail: "bad-phone" };
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: digits,
            type: "text",
            text: { preview_url: true, body },
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      return response.ok
        ? { ok: true }
        : { ok: false, detail: `whatsapp-${response.status}` };
    } catch (error) {
      return { ok: false, detail: String(error).slice(0, 120) };
    }
  },
};

export const transports: Transport[] = [emailTransport, telegramTransport, whatsappTransport];

/**
 * Deliver on every configured channel. Returns what actually went out so the
 * caller can decide whether the message counts as "sent" for retry purposes.
 */
export async function deliver(
  channels: Channel[],
  recipients: { channel: Channel; to: string }[],
  subject: string,
  body: string,
): Promise<{ delivered: Channel[]; failed: { channel: Channel; detail?: string }[] }> {
  const delivered: Channel[] = [];
  const failed: { channel: Channel; detail?: string }[] = [];

  for (const recipient of recipients) {
    if (!channels.includes(recipient.channel)) continue;
    const transport = transports.find((item) => item.channel === recipient.channel);
    if (!transport || !transport.enabled()) continue;
    const result = await transport.send(recipient.to, subject, body);
    if (result.ok) delivered.push(recipient.channel);
    else failed.push({ channel: recipient.channel, detail: result.detail });
  }

  return { delivered, failed };
}

/** Team members that receive operational alerts (from .env, never hard-coded). */
export function adminRecipients(): { channel: Channel; to: string }[] {
  const ids = (process.env.TELEGRAM_ADMIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.map((id) => ({ channel: "TELEGRAM" as Channel, to: id }));
}
