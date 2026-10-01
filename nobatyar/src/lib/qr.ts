/**
 * QR generation.
 *
 * Customers reach the booking page either by link or by scanning a code, so the
 * QR must be produced server-side: the dashboard renders it, the API serves it
 * for posters/stickers, and neither exposes a third-party image request.
 */
import "server-only";
import QRCode from "qrcode";

export type QrStyle = {
  size?: number;
  dark?: string;
  light?: string;
  margin?: number;
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
};

const DEFAULTS: Required<Omit<QrStyle, "size">> = {
  dark: "#0B1B34",
  light: "#FFFFFF",
  margin: 2,
  errorCorrectionLevel: "M",
};

function options(style: QrStyle = {}) {
  return {
    errorCorrectionLevel: style.errorCorrectionLevel ?? DEFAULTS.errorCorrectionLevel,
    margin: style.margin ?? DEFAULTS.margin,
    width: Math.min(Math.max(style.size ?? 512, 96), 2048),
    color: {
      dark: style.dark ?? DEFAULTS.dark,
      light: style.light ?? DEFAULTS.light,
    },
  };
}

/** Inline SVG string — ideal for server components and crisp printing. */
export async function qrSvg(data: string, style?: QrStyle): Promise<string> {
  return QRCode.toString(data, { type: "svg", ...options(style) });
}

export async function qrPng(data: string, style?: QrStyle): Promise<Buffer> {
  return QRCode.toBuffer(data, { type: "png", ...options(style) });
}

/** `data:` URI for contexts that need an <img src> (e.g. the OG image). */
export async function qrDataUri(data: string, style?: QrStyle): Promise<string> {
  const buffer = await qrPng(data, { size: 512, ...style });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitiseStyle(input: {
  size?: string | null;
  dark?: string | null;
  light?: string | null;
  margin?: string | null;
}): QrStyle {
  const style: QrStyle = {};
  if (input.size) {
    const size = Number(input.size);
    if (Number.isFinite(size)) style.size = Math.min(Math.max(size, 96), 2048);
  }
  if (input.dark && HEX.test(input.dark)) style.dark = input.dark;
  if (input.light && HEX.test(input.light)) style.light = input.light;
  if (input.margin) {
    const margin = Number(input.margin);
    if (Number.isFinite(margin)) style.margin = Math.min(Math.max(margin, 0), 8);
  }
  return style;
}

/** Only http(s) links may be encoded — keeps the endpoint a booking asset. */
export function isEncodableUrl(value: string): boolean {
  if (value.length > 800) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
