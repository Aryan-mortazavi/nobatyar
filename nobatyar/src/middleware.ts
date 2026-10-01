import { NextResponse, type NextRequest } from "next/server";

import { defaultLocale, isLocale, locales, type Locale } from "@/lib/i18n";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session-token";

const PUBLIC_FILE = /\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest|json|woff2?)$/i;

/** Routes that never need a session. */
const PUBLIC_PATHS = new Set(["login", "register", "book", "services", "staff", "pricing", "faq"]);

function detectLocale(request: NextRequest): Locale {
  const cookie = request.cookies.get("ny_locale")?.value;
  if (cookie && isLocale(cookie)) return cookie;
  const header = request.headers.get("accept-language") ?? "";
  if (header.toLowerCase().startsWith("en")) return "en";
  if (header.toLowerCase().startsWith("fa")) return "fa";
  return defaultLocale;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/fonts") ||
    pathname.startsWith("/images") ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  // ── 1. locale prefix ────────────────────────────────────────────────────
  const segments = pathname.split("/").filter(Boolean);
  const hasLocale = segments.length > 0 && isLocale(segments[0]);

  if (!hasLocale) {
    const locale = detectLocale(request);
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    const response = NextResponse.redirect(url);
    response.cookies.set("ny_locale", locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return response;
  }

  const locale = segments[0] as Locale;

  // ── 2. auth guard for the dashboard ─────────────────────────────────────
  const section = segments[1] ?? "";
  const needsAuth = section === "dashboard";
  if (!needsAuth && PUBLIC_PATHS.has(section)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (needsAuth && !session) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // signed-in users should not see the auth screens
  if (session && (section === "login" || section === "register")) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/dashboard`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // remember the choice so the next visit starts in the same language
  const response = NextResponse.next();
  if (request.cookies.get("ny_locale")?.value !== locale) {
    response.cookies.set("ny_locale", locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export { locales };
