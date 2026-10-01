/**
 * Live smoke test of the channel API — the exact sequence the Telegram bot
 * performs, so a broken contract is caught before the bot is even running.
 *
 *   npx tsx scripts/channel-smoke.ts
 *
 * Requires a dev server on APP_URL (default http://localhost:3000) and
 * CHANNEL_API_SECRET in the environment (it is read from .env).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** read CHANNEL_API_SECRET out of .env without pulling in a dotenv dependency */
function secret(): string {
  if (process.env.CHANNEL_API_SECRET) return process.env.CHANNEL_API_SECRET;
  const env = readFileSync(join(root, ".env"), "utf8");
  const match = env.match(/^CHANNEL_API_SECRET=(.+)$/m);
  if (!match) throw new Error("CHANNEL_API_SECRET is missing from .env");
  return match[1]!.trim().replace(/^["']|["']$/g, "");
}

const BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_SECRET = secret();

let failures = 0;
let customerToken = "";
const TELEGRAM_ID = String(99_100_000 + Math.floor(Math.random() * 900_000));
/** A fresh Iranian mobile per run: a phone may only ever belong to one Telegram account. */
const PHONE = `09${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
/** the same number with Persian digits and spaces, as a customer would type it */
const PHONE_TYPED = `${PHONE.slice(0, 4)} ${PHONE.slice(4, 7)} ${PHONE.slice(7)}`
  .split("")
  .map((char) => (char >= "0" && char <= "9" ? "۰۱۲۳۴۵۶۷۸۹"[Number(char)] : char))
  .join("");

function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`✔ ${label}`);
  } else {
    failures += 1;
    console.log(`✘ ${label}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 300)}`}`);
  }
}

async function call(
  path: string,
  init: RequestInit & { customer?: boolean; telegramId?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_SECRET}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.customer !== false && customerToken) headers["X-Customer-Token"] = customerToken;
  if (init.telegramId ?? customerToken) headers["X-Telegram-Id"] = init.telegramId ?? TELEGRAM_ID;

  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: response.status, body };
}

async function main(): Promise<void> {
  console.log(`channel API smoke test → ${BASE}\ntelegram id: ${TELEGRAM_ID}\nphone: ${PHONE}\n`);

  // ── 0. the gate must actually gate ───────────────────────────────────────
  const noAuth = await fetch(`${BASE}/api/v1/catalogue`);
  check("catalogue rejects a missing channel secret (401)", noAuth.status === 401, noAuth.status);

  const badAuth = await fetch(`${BASE}/api/v1/catalogue`, {
    headers: { Authorization: "Bearer wrong-secret" },
  });
  check("catalogue rejects a wrong channel secret (401)", badAuth.status === 401, badAuth.status);

  // ── 1. catalogue: one call fills the whole menu ──────────────────────────
  const catalogue = await call("/api/v1/catalogue?locale=fa", { customer: false });
  check("catalogue → 200", catalogue.status === 200, catalogue.body);
  const workspace = catalogue.body?.data?.workspace;
  const services = catalogue.body?.data?.services ?? [];
  const staff = catalogue.body?.data?.staff ?? [];
  check("catalogue carries the workspace", Boolean(workspace?.name), workspace);
  check("catalogue lists services", services.length > 0, services.length);
  check("catalogue lists staff", staff.length > 0, staff.length);
  check("catalogue carries Persian labels", catalogue.body?.data?.labels?.book?.includes("رزرو") === true);
  check(
    "every service has a web deep link",
    services.every((service: any) => service.webUrl.includes("/fa/book?service=")),
  );

  const service = services[0];
  const staffMember = staff.find((member: any) => service.staffIds.includes(member.id)) ?? staff[0];

  // ── 2. identify: Telegram account becomes a real customer ────────────────
  const identify = await call("/api/v1/customers/identify", {
    method: "POST",
    customer: false,
    body: JSON.stringify({
      telegramId: TELEGRAM_ID,
      telegramUsername: "smoke_tester",
      name: "مشتری تست کانال",
      // Persian digits + spaces: exactly what a Telegram user types
      phone: PHONE_TYPED,
      locale: "fa",
    }),
  });
  check("identify → 200", identify.status === 200, identify.body);
  customerToken = identify.body?.data?.token ?? "";
  check("identify returns a customer token", customerToken.length > 40);
  check(
    `phone was normalised to ${PHONE}`,
    identify.body?.data?.customer?.phone === PHONE,
    identify.body?.data?.customer?.phone,
  );
  check("identify greets the customer", typeof identify.body?.data?.welcome === "string");

  if (!customerToken) {
    console.log("\nidentify failed — the rest of the flow needs a customer token, stopping here.");
    process.exit(1);
  }

  // the same phone must resolve to the same person on a second call
  const again = await call("/api/v1/customers/identify", {
    method: "POST",
    customer: false,
    body: JSON.stringify({
      telegramId: TELEGRAM_ID,
      name: "مشتری تست کانال",
      phone: PHONE,
      locale: "fa",
    }),
  });
  check(
    "re-identifying does not create a second customer",
    again.body?.data?.customer?.id === identify.body?.data?.customer?.id,
  );

  // ── 3. availability: the same engine the website uses ───────────────────
  const range = await call(
    `/api/v1/availability?serviceId=${service.id}&staffId=${staffMember.id}&days=30`,
  );
  check("availability range → 200", range.status === 200, range.body);
  const bookableDays = (range.body?.data?.days ?? []).filter((day: any) => day.bookable);
  check("availability range finds bookable days", bookableDays.length > 0, bookableDays.length);

  // the *last* bookable day: the demo data only fills the next ~12 days, so a
  // slot near the end of the horizon is reliably free however often this runs
  const target = bookableDays[bookableDays.length - 1];
  const day = await call(
    `/api/v1/availability?serviceId=${service.id}&staffId=${staffMember.id}&date=${target.date}`,
  );
  check("availability day → 200", day.status === 200, day.body);
  const freeSlots = (day.body?.data?.slots ?? []).filter((slot: any) => slot.available);
  check("availability day returns free slots", freeSlots.length > 0, freeSlots.length);

  // ── 4. book ─────────────────────────────────────────────────────────────
  // try the free slots in turn: a previous run may have taken the first one
  let slot = freeSlots[0];
  let book = { status: 0, body: {} as any };
  for (const candidate of freeSlots.slice(0, 6)) {
    book = await call("/api/v1/appointments", {
      method: "POST",
      body: JSON.stringify({
        serviceId: service.id,
        staffId: staffMember.id,
        slot: candidate.start,
        notes: "رزرو از طریق بات",
        locale: "fa",
      }),
    });
    if (book.status === 200) {
      slot = candidate;
      break;
    }
  }
  check("booking → 200", book.status === 200, book.body);
  const tracking = book.body?.data?.trackingCode;
  check("booking returns a tracking code", /^APT-[A-Z0-9]{5}$/.test(tracking ?? ""), tracking);
  check("booking returns the appointment view", Boolean(book.body?.data?.appointments?.[0]?.when?.date));
  check(
    "booking is tagged as a Telegram booking",
    book.body?.data?.appointments?.[0]?.source === "TELEGRAM",
    book.body?.data?.appointments?.[0]?.source,
  );

  // the same slot twice must be refused by the engine, not by luck
  const doubleBook = await call("/api/v1/appointments", {
    method: "POST",
    body: JSON.stringify({
      serviceId: service.id,
      staffId: staffMember.id,
      slot: slot.start,
      name: "دیگری",
      phone: "09120000000",
      locale: "fa",
    }),
  });
  check("double booking the same slot is refused (409)", doubleBook.status === 409, {
    status: doubleBook.status,
    body: doubleBook.body,
  });

  // ── 5. the customer's own list ──────────────────────────────────────────
  const mine = await call("/api/v1/appointments?scope=upcoming");
  check("my appointments → 200", mine.status === 200, mine.body);
  const listed = (mine.body?.data?.appointments ?? []).map((row: any) => row.trackingCode);
  check(
    "the booking appears in the customer's list",
    listed.includes(tracking),
    { tracking, listed, scope: mine.body?.data?.scope },
  );
  if (!listed.includes(tracking)) {
    // the token subject and the booking owner must be the same person
    const payload = JSON.parse(
      Buffer.from(customerToken.split(".")[1]!, "base64url").toString("utf8"),
    );
    console.log(`   debug: token sub=${payload.sub} tid=${payload.tid} identify customer=${identify.body?.data?.customer?.id}`);
  }

  // another customer must not see it
  const otherIdentify = await call("/api/v1/customers/identify", {
    method: "POST",
    customer: false,
    body: JSON.stringify({
      telegramId: String(Number(TELEGRAM_ID) + 1),
      name: "مشتری دیگر",
      phone: `09${String(Number(PHONE.slice(2)) + 1).padStart(9, "0")}`,
      locale: "fa",
    }),
  });
  const otherToken = otherIdentify.body?.data?.token;
  check("a second customer can identify too", Boolean(otherToken), otherIdentify.body);
  const foreign = await fetch(`${BASE}/api/v1/appointments/${tracking}/cancel?locale=fa`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_SECRET}`,
      "X-Customer-Token": otherToken ?? "",
      "X-Telegram-Id": String(Number(TELEGRAM_ID) + 1),
    },
  });
  const foreignBody = await foreign.text();
  check(
    "a stranger cannot cancel somebody's appointment (404, never 403)",
    foreign.status === 404,
    { status: foreign.status, body: foreignBody.slice(0, 200) },
  );

  // ── 6. cancel ───────────────────────────────────────────────────────────
  const cancel = await call(`/api/v1/appointments/${tracking}/cancel?locale=fa`, { method: "POST" });
  check("cancel → 200", cancel.status === 200, cancel.body);
  check("cancel reports success", cancel.body?.data?.cancelled === true);

  const cancelAgain = await call(`/api/v1/appointments/${tracking}/cancel?locale=fa`, { method: "POST" });
  check("cancelling twice is refused (409)", cancelAgain.status === 409, cancelAgain.status);

  // ── 7. packages, waitlist, support ──────────────────────────────────────
  const packages = await call("/api/v1/packages?locale=fa");
  check("packages → 200", packages.status === 200, packages.body);
  check("packages returns a list", Array.isArray(packages.body?.data?.packages));

  const waitlist = await call("/api/v1/waitlist", {
    method: "POST",
    body: JSON.stringify({ serviceId: service.id, date: target.date, preferredStartMinute: 600, locale: "fa" }),
  });
  check("waitlist join → 200", waitlist.status === 200, waitlist.body);
  check("waitlist entry created", waitlist.body?.data?.created === true, waitlist.body?.data);

  const waitlistAgain = await call("/api/v1/waitlist", {
    method: "POST",
    body: JSON.stringify({ serviceId: service.id, date: target.date, preferredStartMinute: 600, locale: "fa" }),
  });
  check("the same day is not queued twice", waitlistAgain.body?.data?.created === false);

  const support = await call("/api/v1/support", {
    method: "POST",
    body: JSON.stringify({ message: "سلام، از ربات پیام می‌فرستم.", locale: "fa" }),
  });
  check("support message → 200", support.status === 200, support.body);
  check("support ticket created", Boolean(support.body?.data?.ticketId));

  // ── 8. the customer is now a real web user ──────────────────────────────
  const webLogin = await fetch(`${BASE}/api/health`);
  check("the web app is still healthy", webLogin.status === 200, webLogin.status);

  console.log(`\n${failures === 0 ? "ALL CHANNEL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
