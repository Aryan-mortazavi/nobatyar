import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * End-to-end configuration.
 *
 * The suite runs against a real Next.js server and a throw-away SQLite file,
 * so it exercises exactly what production runs: middleware, server actions,
 * Prisma and the availability engine.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // one worker: the tests share one database
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // A dedicated port and a throw-away database, wiped and re-seeded on every
    // run so the suite never depends on (or damages) the development data.
    command: [
      `node -e "require('fs').rmSync('prisma/e2e.db',{force:true})"`,
      `npx prisma db push --skip-generate --accept-data-loss`,
      `npx tsx prisma/seed.ts`,
      `npx next start -p ${PORT}`,
    ].join(" && "),
    url: baseURL,
    // when a server is already listening (manual debugging) keep it and its data
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: "file:./e2e.db",
      AUTH_SECRET: "e2e-secret-key-at-least-32-characters-long",
      NEXT_PUBLIC_APP_URL: baseURL,
      NEXT_PUBLIC_DEFAULT_LOCALE: "fa",
    },
  },
});
