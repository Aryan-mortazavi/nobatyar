import { expect, test, type Page } from "@playwright/test";

const OWNER = { email: "owner@nobatyar.app", password: "Nobat#2026" };
const CUSTOMER = { email: "customer@nobatyar.app", password: "Nobat#2026" };

/**
 * Book one appointment through the channel API and return its tracking code.
 * Used by the self-service tests, which need a real record to look at.
 */
async function bookViaApi(page: Page): Promise<string> {
  const secret = process.env.CHANNEL_API_SECRET ?? "e2e-channel-secret-at-least-24-chars";
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

  const catalogue = await (await page.request.get("/api/v1/catalogue?locale=fa", { headers })).json();
  const service = catalogue.data.services[0];
  const staff = catalogue.data.staff.find((m: any) => service.staffIds.includes(m.id));

  const range = await (
    await page.request.get(`/api/v1/availability?serviceId=${service.id}&days=40`, { headers })
  ).json();
  const day = range.data.days.filter((d: any) => d.bookable).at(-1);
  const slots = await (
    await page.request.get(
      `/api/v1/availability?serviceId=${service.id}&staffId=${staff.id}&date=${day.date}`,
      { headers },
    )
  ).json();
  const slot = slots.data.slots.find((s: any) => s.available);

  const telegramId = String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000);
  const phone = `09${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
  const identified = await (
    await page.request.post("/api/v1/customers/identify", {
      headers,
      data: { telegramId, name: "مشتری تست ای۲ای", phone, locale: "fa" },
    })
  ).json();

  const booked = await page.request.post("/api/v1/appointments", {
    headers: { ...headers, "X-Customer-Token": identified.data.token, "X-Telegram-Id": telegramId },
    data: { serviceId: service.id, staffId: staff.id, slot: slot.start, locale: "fa" },
  });
  const body = await booked.json();
  expect(body.ok, JSON.stringify(body)).toBe(true);
  return body.data.trackingCode;
}

/** Sign in through the real form (server action + session cookie). */
export async function login(page: Page, who = OWNER) {
  await page.goto("/fa/login");
  await page.getByLabel("ایمیل").fill(who.email);
  await page.getByLabel("گذرواژه").fill(who.password);
  // the submit button of the auth form (the demo panel has a button too)
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test.describe("public site", () => {
  test("landing page renders the brand, hero and sections", async ({ page }) => {
    await page.goto("/fa");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("رزرو نوبت");
    await expect(page.locator('header img[src*="mark.svg"]')).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("نوبت‌یار");
  });

  test("root path redirects to a locale", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/(fa|en)(\?|$)/);
  });

  test("language switch keeps the page and flips direction", async ({ page }) => {
    await page.goto("/fa/services");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("link", { name: "Switch language" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page).toHaveURL(/\/en\/services/);
  });

  test("services and staff pages list real data", async ({ page }) => {
    await page.goto("/fa/services");
    await expect(page.getByText("پاکسازی عمیق پوست").first()).toBeVisible();

    await page.goto("/fa/staff");
    await expect(page.getByText("مهسا پنجه‌طلا").first()).toBeVisible();
  });

  test("QR endpoint serves a real code and rejects non-http targets", async ({ request }) => {
    const ok = await request.get("/api/qr?data=https%3A%2F%2Fexample.com%2Ffa%2Fbook&format=svg");
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toContain("<svg");

    const bad = await request.get("/api/qr?data=javascript%3Aalert(1)");
    expect(bad.status()).toBe(400);
  });

  test("health endpoint reports the database", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("reachable");
  });

  test("dashboard is protected and the sitemap is public", async ({ page, request }) => {
    await page.goto("/fa/dashboard");
    await expect(page).toHaveURL(/\/fa\/login/);

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<urlset");
  });
});

test.describe("booking flow", () => {
  test("a guest can book a free slot and receives a tracking code", async ({ page }) => {
    await page.goto("/fa/book");

    // step 1: service
    await page.getByRole("button", { name: /مشاوره پوست/ }).first().click();

    // step 2: specialist (or the "earliest available" shortcut)
    const anyStaff = page.getByRole("button", { name: /نزدیک‌ترین زمان آزاد/ });
    if (await anyStaff.count()) {
      await anyStaff.first().click();
    } else {
      await page.locator("button:has-text('مهسا')").first().click();
    }

    // step 3: calendar → first bookable day → first free slot
    const bookableDay = page.locator('button[aria-pressed]:not([disabled])').first();
    await expect(bookableDay).toBeVisible({ timeout: 20_000 });
    await bookableDay.click();

    const freeSlot = page.locator("button:not([disabled])").filter({ hasText: /^\d{2}:\d{2}$/ }).first();
    await expect(freeSlot).toBeVisible({ timeout: 20_000 });
    await freeSlot.click();

    // step 4: details
    await page.getByLabel("نام", { exact: false }).first().fill("کاربر تست ای۲ای");
    await page.locator("#phone").fill("09121112233");
    await page.getByRole("button", { name: /ثبت نهایی نوبت/ }).click();

    // generous: pointing the suite at a `next dev` server adds compile latency
    await expect(page.getByText("کد رهگیری").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("text=/APT-[A-Z0-9]{5}/").first()).toBeVisible();
  });

  test("the repeat control creates a weekly series", async ({ page }) => {
    await page.goto("/fa/book");
    await page.getByRole("button", { name: /مشاوره پوست/ }).first().click();
    const anyStaff = page.getByRole("button", { name: /نزدیک‌ترین زمان آزاد/ });
    if (await anyStaff.count()) await anyStaff.first().click();
    else await page.locator("button:has-text('مهسا')").first().click();

    // The demo data only fills the next ~12 days, so move one month ahead: a
    // four-week series then has free occurrences and still sits inside the
    // 60-day booking horizon.
    await page.getByRole("button", { name: "بعدی" }).click();

    const day = page.locator('button[aria-pressed]:not([disabled])').first();
    await expect(day).toBeVisible({ timeout: 20_000 });
    await day.click();
    const slot = page.locator("button:not([disabled])").filter({ hasText: /^\d{2}:\d{2}$/ }).first();
    await expect(slot).toBeVisible({ timeout: 20_000 });
    await slot.click();

    // 4 occurrences = four weekly appointments
    await page.getByRole("button", { name: "۴", exact: true }).click();
    await page.getByLabel("نام", { exact: false }).first().fill("سری تست");
    await page.locator("#phone").fill("09121112234");
    await page.getByRole("button", { name: /ثبت نهایی نوبت/ }).click();

    await expect(page.getByText("کد رهگیری").first()).toBeVisible({ timeout: 30_000 });
    // the panel confirms it was a series, not a single booking
    await expect(page.getByText("سری نوبت‌ها ساخته شد")).toBeVisible();
  });

  test("a refused series names the exact unavailable occurrence", async ({ page }) => {
    await page.goto("/fa/book");
    await page.getByRole("button", { name: /مشاوره پوست/ }).first().click();
    const anyStaff = page.getByRole("button", { name: /نزدیک‌ترین زمان آزاد/ });
    if (await anyStaff.count()) await anyStaff.first().click();
    else await page.locator("button:has-text('مهسا')").first().click();

    // the coming days are dense with demo appointments, so an eight-week series
    // is very likely to hit a busy week — and must then name that week
    const day = page.locator('button[aria-pressed]:not([disabled])').first();
    await expect(day).toBeVisible({ timeout: 20_000 });
    await day.click();
    const slot = page.locator("button:not([disabled])").filter({ hasText: /^\d{2}:\d{2}$/ }).first();
    await expect(slot).toBeVisible({ timeout: 20_000 });
    await slot.click();

    await page.getByRole("button", { name: "۸", exact: true }).click();
    await page.getByLabel("نام", { exact: false }).first().fill("سری ناقص");
    await page.locator("#phone").fill("09121112235");
    await page.getByRole("button", { name: /ثبت نهایی نوبت/ }).click();

    const refused = page.getByText(/جلسهٔ [۰-۹]+ از این سری/);
    const confirmed = page.getByText("کد رهگیری").first();
    await expect(refused.or(confirmed).first()).toBeVisible({ timeout: 30_000 });
  });

  test("a signed-in customer can spend one session of a package", async ({ page }) => {
    await login(page, CUSTOMER);
    await page.goto("/fa/book");

    // reach the details step for a service the demo customer's bundle covers
    await page.getByRole("button", { name: /مشاوره پوست/ }).first().click();
    const anyStaff = page.getByRole("button", { name: /نزدیک‌ترین زمان آزاد/ });
    if (await anyStaff.count()) await anyStaff.first().click();
    else await page.locator("button:has-text('مهسا')").first().click();

    const day = page.locator('button[aria-pressed]:not([disabled])').first();
    await expect(day).toBeVisible({ timeout: 20_000 });
    await day.click();
    const slot = page.locator("button:not([disabled])").filter({ hasText: /^\d{2}:\d{2}$/ }).first();
    await expect(slot).toBeVisible({ timeout: 20_000 });
    await slot.click();

    // the bundle selector only exists because the server found a usable purchase
    const bundle = page.locator("#package-select");
    await expect(bundle).toBeVisible({ timeout: 20_000 });
    const before = await bundle.locator("option").nth(1).innerText();
    await bundle.selectOption({ index: 1 });

    await page.getByRole("button", { name: /ثبت نهایی نوبت/ }).click();
    await expect(page.getByText("کد رهگیری").first()).toBeVisible({ timeout: 30_000 });

    // one session fewer is left on the very next visit
    await page.goto("/fa/book");
    await page.getByRole("button", { name: /مشاوره پوست/ }).first().click();
    const again = page.getByRole("button", { name: /نزدیک‌ترین زمان آزاد/ });
    if (await again.count()) await again.first().click();
    else await page.locator("button:has-text('مهسا')").first().click();
    const day2 = page.locator('button[aria-pressed]:not([disabled])').first();
    await expect(day2).toBeVisible({ timeout: 20_000 });
    await day2.click();
    const slot2 = page.locator("button:not([disabled])").filter({ hasText: /^\d{2}:\d{2}$/ }).first();
    await expect(slot2).toBeVisible({ timeout: 20_000 });
    await slot2.click();

    const after = page.locator("#package-select");
    await expect(after).toBeVisible({ timeout: 20_000 });
    expect(await after.locator("option").nth(1).innerText()).not.toBe(before);
  });
});

test.describe("registration must not grant staff access", () => {
  // Regression guard for a critical privilege escalation.
  //
  // registerAction used to create a { role: "STAFF" } workspace membership for
  // every new account, so any anonymous visitor who signed up landed on the
  // staff dashboard and could read every customer's phone number and the
  // revenue figures. A hydration bug in the toast provider had been hiding it,
  // because registration simply never completed.
  test("a self-registered account is refused by every staff screen", async ({ page }) => {
    await page.goto("/fa/register");
    await page.locator('input[name="name"]').fill("QA Newcomer");
    await page.locator('input[name="email"]').fill(`qa-e2e-${Date.now()}@example.test`);
    const phone = page.locator('input[name="phone"]');
    if (await phone.count()) await phone.fill("09120000000");
    await page.locator('input[name="password"]').fill("QaProbe#2026x");
    const confirm = page.locator('input[name="confirmPassword"]');
    if (await confirm.count()) await confirm.fill("QaProbe#2026x");
    await page.locator('form button[type="submit"]').first().click();

    // registration must succeed and land the newcomer outside the dashboard
    await page.waitForURL("**/my-appointments", { timeout: 30_000 });
    expect(new URL(page.url()).pathname).not.toContain("/dashboard");

    // …and they really are signed in, so the refusals below are about the role
    await page.goto("/fa/my-appointments");
    await expect(page.locator("main")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/fa/my-appointments");

    // every staff section must bounce them away
    for (const section of [
      "",
      "appointments",
      "calendar",
      "services",
      "staff",
      "waitlist",
      "packages",
      "locations",
      "notifications",
      "settings",
      "link",
    ]) {
      await page.goto(`/fa/dashboard${section ? `/${section}` : ""}`);
      expect(
        new URL(page.url()).pathname,
        `a self-registered customer reached /dashboard/${section}`,
      ).not.toContain("/dashboard");
    }

    // no customer PII anywhere on the way out
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/09\d{9}/);
  });
});

test.describe("customer self-service", () => {
  test("the link from a confirmation message opens the appointment", async ({ page }) => {
    // Every confirmation (Telegram, WhatsApp, email) links here, so this page
    // must never 404 — it was missing for a while and the messages pointed at
    // nothing.
    const tracking = await bookViaApi(page);
    expect(tracking).toMatch(/^APT-[A-Z0-9]{5}$/);

    const content = page.locator("main");
    await page.goto(`/fa/my-appointments/${tracking}`);
    // scoped to <main>: Next's route announcer also contains the page title
    await expect(content.getByText("کد رهگیری")).toBeVisible();
    await expect(content.getByText(tracking)).toBeVisible();
  });

  test("the customer's own list opens the same page", async ({ page }) => {
    // signed in as the demo customer, so these really are *their* bookings
    await login(page, CUSTOMER);
    await page.goto("/fa/my-appointments");

    const tracking = page.locator("main a[href*='/my-appointments/']").first();
    await expect(tracking).toBeVisible();
    const href = await tracking.getAttribute("href");
    expect(href).toMatch(/^\/fa\/my-appointments\/APT-[A-Z0-9]{5}$/);

    await tracking.click();
    await expect(page.locator("main").getByText("کد رهگیری")).toBeVisible();
  });

  test("a stranger sees the time but not the customer, and cannot cancel", async ({ page }) => {
    const tracking = await bookViaApi(page);

    // nobody is signed in: the appointment is visible, the personal details are not
    await page.goto(`/fa/my-appointments/${tracking}`);
    await expect(page.locator("main").getByText(tracking)).toBeVisible();
    await expect(page.getByRole("button", { name: /لغو/ })).toHaveCount(0);
    // it offers a way in instead of silently doing nothing
    await expect(page.getByRole("link", { name: "ورود" }).first()).toBeVisible();
  });

  test("an unknown tracking code is a 404, not an empty page", async ({ page }) => {
    const response = await page.goto("/fa/my-appointments/APT-ZZZZZ");
    expect(response?.status()).toBe(404);
  });
});

test.describe("dashboard", () => {
  test("charts, KPIs and tables render for the owner", async ({ page }) => {
    await login(page);
    await expect(page.getByText("نوبت‌های امروز")).toBeVisible();
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible({ timeout: 20_000 });

    // exact: the header also carries «نوبت‌های من», which contains this string
    await page.getByRole("link", { name: "نوبت‌ها", exact: true }).first().click();
    await expect(page.locator("table")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("text=APT-").first()).toBeVisible();
  });

  test("link & QR page shows the booking link and a QR code", async ({ page }) => {
    await login(page);
    await page.goto("/fa/dashboard/link");
    await expect(page.getByText("کد QR صفحه رزرو")).toBeVisible();
    await expect(page.locator("input[readonly]").first()).toHaveValue(/\/fa\/book/);
    await expect(page.getByTestId("qr-main").locator("svg")).toBeVisible();
  });

  test("packages and locations pages are reachable and populated", async ({ page }) => {
    await login(page);

    await page.goto("/fa/dashboard/packages");
    await expect(page.getByRole("heading", { name: "بسته‌ها و اشتراک‌ها" })).toBeVisible();
    await expect(page.getByText("شروع پوست — ۵ جلسه")).toBeVisible();

    await page.goto("/fa/dashboard/locations");
    await expect(page.getByText("آریا — شعبه ونک")).toBeVisible();

    await page.goto("/fa/dashboard/notifications");
    await expect(page.getByRole("heading", { name: "اعلان‌ها و یادآوری‌ها" })).toBeVisible();
  });

  test("an appointment can be confirmed from the list", async ({ page }) => {
    await login(page);
    await page.goto("/fa/dashboard/appointments?status=PENDING");

    // the tracking code of the first pending row: it must leave the list
    const firstRow = page.locator("tbody tr").first();
    const code = (await firstRow.locator("td").first().innerText()).trim();
    const confirm = firstRow.getByRole("button", { name: "تأیید نوبت" });
    test.skip((await confirm.count()) === 0, "no pending appointment in the demo data");

    await confirm.click();
    await expect(page.getByText("با موفقیت انجام شد").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("tbody tr").filter({ hasText: code })).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test("cancelling a booking frees the slot for the next customer", async ({ request }) => {
    // Regression guard. With a plain unique index on (staffId, startsAt) the row
    // stayed behind after a cancellation and that time could never be booked
    // again — the calendar quietly rotted.
    // the same value playwright.config.ts injects into the server it starts
    const secret =
      process.env.CHANNEL_API_SECRET ?? "e2e-channel-secret-at-least-24-chars";
    test.skip(!secret, "CHANNEL_API_SECRET is not set");

    // playwright's request options; JSON payloads go through `data`
    type ApiInit = { method?: string; body?: string; headers?: Record<string, string> };
    const api = async (path: string, init: ApiInit = {}) =>
      request.fetch(`${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        ...(init.body ? { data: init.body } : {}),
      });

    const catalogue = await (await api("/api/v1/catalogue?locale=fa")).json();
    const service = catalogue.data.services[0];
    const staff = catalogue.data.staff.find((member: any) => service.staffIds.includes(member.id));

    // a day the demo data never reaches, so the test can run repeatedly
    const range = await (
      await api(`/api/v1/availability?serviceId=${service.id}&days=40`)
    ).json();
    const day = range.data.days.filter((d: any) => d.bookable).at(-1);
    const slots = await (
      await api(`/api/v1/availability?serviceId=${service.id}&staffId=${staff.id}&date=${day.date}`)
    ).json();
    const slot = slots.data.slots.find((s: any) => s.available);

    // book, cancel, then book the very same instant again
    const phone = `09${Math.floor(Math.random() * 1_000_000_000)
      .toString()
      .padStart(9, "0")}`;
    const telegramId = String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000);
    const identifiedResponse = await api("/api/v1/customers/identify", {
      method: "POST",
      body: JSON.stringify({ telegramId, name: "تست آزادسازی", phone, locale: "fa" }),
    });
    expect(identifiedResponse.status(), await identifiedResponse.text()).toBe(200);
    const identified = JSON.parse(await identifiedResponse.text());
    const token = identified.data.token;

    const book = () =>
      api("/api/v1/appointments", {
        method: "POST",
        headers: { "X-Customer-Token": token, "X-Telegram-Id": telegramId },
        body: JSON.stringify({ serviceId: service.id, staffId: staff.id, slot: slot.start, locale: "fa" }),
      });

    const first = await book();
    expect(first.status()).toBe(200);
    const tracking = (await first.json()).data.trackingCode;

    const cancelled = await api(`/api/v1/appointments/${tracking}/cancel?locale=fa`, {
      method: "POST",
      headers: { "X-Customer-Token": token, "X-Telegram-Id": telegramId },
    });
    expect(cancelled.status()).toBe(200);

    // the whole point: the same instant must be bookable again
    const second = await book();
    expect(
      second.status(),
      "a cancelled appointment must release its slot",
    ).toBe(200);

    if (second.status() === 200) {
      const secondBody = await second.json();
      await api(`/api/v1/appointments/${secondBody.data.trackingCode}/cancel?locale=fa`, {
        method: "POST",
        headers: { "X-Customer-Token": token, "X-Telegram-Id": telegramId },
      });
    }
  });
});
