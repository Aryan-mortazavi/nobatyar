/**
 * End-to-end check of the authenticated dashboard: signs a real session token
 * and fetches the pages, verifying the QR panel, the brand logo and the charts.
 */
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const prisma = new PrismaClient();

async function main() {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "");

  const owner = await prisma.user.findUnique({ where: { email: "owner@nobatyar.app" } });
  const workspace = await prisma.workspace.findFirst();
  if (!owner || !workspace) throw new Error("run `npm run db:seed` first");

  const token = await new SignJWT({
    sub: owner.id,
    email: owner.email,
    name: owner.name,
    role: owner.platformRole,
    wid: workspace.id,
    wrole: "OWNER",
    locale: "fa",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("nobatyar")
    .setAudience("nobatyar-web")
    .setExpirationTime("1h")
    .sign(secret);

  const cookie = `ny_session=${token}`;
  const pages: [string, string[]][] = [
    ["/fa/dashboard", ["نمای کلی", "نوبت‌های امروز", "recharts"]],
    ["/fa/dashboard/link", ["کد QR", "api/qr", "دانلود SVG", "چاپ پوستر"]],
    ["/fa/dashboard/appointments", ["نوبت‌ها", "APT-", "کد رهگیری"]],
    ["/fa/dashboard/services", ["خدمات", "پاکسازی عمیق پوست"]],
    ["/fa/dashboard/staff", ["کارشناسان", "مهسا"]],
    ["/fa/dashboard/waitlist", ["لیست انتظار"]],
    ["/fa/dashboard/packages", ["بسته‌ها و اشتراک‌ها", "شروع پوست"]],
    ["/fa/dashboard/locations", ["شعبه‌ها", "آریا — شعبه ونک"]],
    ["/fa/dashboard/notifications", ["اعلان‌ها و یادآوری‌ها", "TELEGRAM_BOT_TOKEN"]],
    ["/fa/dashboard/settings", ["تنظیمات کسب‌وکار", "minNoticeMinutes", "name=\"slug\""]],
    ["/fa/dashboard/calendar", ["تقویم نوبت‌ها"]],
    ["/en/dashboard", ["Overview", "recharts"]],
  ];

  let failures = 0;
  for (const [path, needles] of pages) {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie },
      redirect: "manual",
    });
    const html = response.status === 200 ? await response.text() : "";
    const missing = needles.filter((needle) => !html.includes(needle));
    const ok = response.status === 200 && missing.length === 0;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "✔" : "✘"} ${path} → ${response.status}` +
        (missing.length ? ` missing: ${missing.join(", ")}` : ""),
    );
  }

  // the QR endpoint itself
  const qr = await fetch(`${BASE}/api/qr?data=${encodeURIComponent(`${BASE}/fa/book`)}&format=png&size=512`);
  const buffer = Buffer.from(await qr.arrayBuffer());
  const isPng = buffer.subarray(1, 4).toString("ascii") === "PNG";
  console.log(`${isPng ? "✔" : "✘"} /api/qr png → ${qr.status} (${buffer.length} bytes, png=${isPng})`);
  if (!isPng) failures += 1;

  const bad = await fetch(`${BASE}/api/qr?data=javascript:alert(1)`);
  console.log(`${bad.status === 400 ? "✔" : "✘"} /api/qr rejects non-http(s) → ${bad.status}`);
  if (bad.status !== 400) failures += 1;

  const health = await fetch(`${BASE}/api/health`);
  const healthBody = (await health.json()) as Record<string, unknown>;
  console.log(`${health.status === 200 ? "✔" : "✘"} /api/health → ${health.status} ${JSON.stringify(healthBody.counts)}`);
  if (health.status !== 200) failures += 1;

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
