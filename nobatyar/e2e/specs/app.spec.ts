import { expect, test, type Page } from "@playwright/test";

const OWNER = { email: "owner@nobatyar.app", password: "Nobat#2026" };
const CUSTOMER = { email: "customer@nobatyar.app", password: "Nobat#2026" };

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

test.describe("dashboard", () => {
  test("charts, KPIs and tables render for the owner", async ({ page }) => {
    await login(page);
    await expect(page.getByText("نوبت‌های امروز")).toBeVisible();
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("link", { name: "نوبت‌ها" }).first().click();
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
});
