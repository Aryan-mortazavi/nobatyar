import { NextResponse, type NextRequest } from "next/server";

import { isEncodableUrl, qrPng, qrSvg, sanitiseStyle } from "@/lib/qr";
import { rateLimit } from "@/lib/rate-limit";

/**
 * GET /api/qr?data=<url>&format=svg|png&size=512&dark=%230B1B34
 *
 * Renders the booking QR so businesses can print it on posters, menus,
 * receipts or stickers. Only http(s) links are accepted.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const data = params.get("data") ?? "";
  const format = (params.get("format") ?? "svg").toLowerCase();
  const style = sanitiseStyle({
    size: params.get("size"),
    dark: params.get("dark"),
    light: params.get("light"),
    margin: params.get("margin"),
  });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = rateLimit(`qr:${ip}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  if (!isEncodableUrl(data)) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const cache = { "Cache-Control": "public, max-age=3600, s-maxage=86400" };

  if (format === "png") {
    const png = await qrPng(data, style);
    return new NextResponse(new Uint8Array(png), {
      headers: { ...cache, "Content-Type": "image/png" },
    });
  }

  const svg = await qrSvg(data, style);
  return new NextResponse(svg, {
    headers: {
      ...cache,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": 'inline; filename="nobatyar-qr.svg"',
    },
  });
}
