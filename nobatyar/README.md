# NobatYar — نوبت‌یار

> 📖 **New here?** Read the [Complete Guide](../GUIDE.md) — how it works, every
> screen, every panel, and how to run it from zero.

![Graphical abstract of NobatYar](docs/graphical-abstract.png)

> **سامانه هوشمند رزرو نوبت آنلاین** — لینک و کد QR، تقویم شمسی، پنل مدیریت و یادآوری خودکار.
> A production-grade, multi-tenant appointment platform. Bilingual (fa RTL / en LTR), QR + link
> access, real availability, dashboards, reminders.

**NobatYar** is a scheduling platform for clinics, salons, consultants, schools and any
service business. Customers book in under a minute — **by link or by scanning a QR code** —
while staff manage services, schedules, holidays, waitlists and analytics from one dashboard.

---

## شروع سریع (Persian quick start)

```bash
npm install          # نصب وابستگی‌ها
cp .env.example .env # تنظیم DATABASE_URL و AUTH_SECRET
npx prisma db push   # ساخت جداول
npm run db:seed      # داده نمونه (یک کسب‌وکار، ۶ خدمت، ۴ کارشناس، ۷۵ نوبت)
npm run dev          # http://localhost:3000  →  /fa یا /en
```

ورود به پنل: `owner@nobatyar.app` / `Nobat#2026`

لینک و کد QR: پس از ورود، از مسیر **پنل ← لینک و QR** کد را چاپ کنید یا دانلود بگیرید.
هر خدمت کد جداگانه دارد تا مشتری مستقیم به همان صفحه برسد.

قابلیت‌های جدید: **نوبت تکرارشوندهٔ هفتگی** (تا ۱۲ جلسه، یک‌جا و اتمی)،
**بستهٔ چند جلسه‌ای** (مشتری وارد حساب خود می‌شود و یکی از جلسات باقیمانده را مصرف می‌کند)،
**چند شعبه** (هر شعبه کارشناسان و خدمات خودش را دارد) و
**اعلان‌های تلگرام و واتساپ** (کانال‌ها با متغیرهای محیطی فعال می‌شوند؛
وضعیت هر پیام در **پنل ← اعلان‌ها** دیده می‌شود).

---

## Features

| Area | What ships |
|------|-----------|
| **Booking** | 4-step wizard: service → specialist → date → time → details → tracking code. Guest booking without an account, or "earliest available" across the whole team. |
| **Recurring** | Book N weekly sessions in one go (1–12). All-or-nothing: every occurrence is validated first, and a refusal names the exact week that is gone. |
| **Packages** | Prepaid session bundles (e.g. "2 × facial + 3 × laser"). A signed-in customer spends one session per booking; the quota is per service and decremented inside the booking transaction, so a session can never be used twice. |
| **Multi-location** | Branches with their own staff and service lists. Picking a branch filters the calendar to the specialists who work there; bookings store the branch. |
| **Availability engine** | Pure, fully unit-tested: weekly windows, breaks, holidays, time off, per-service buffers, min-notice, booking horizon, half-open overlap rules, union/merge across several specialists. |
| **Double-booking protection** | Two layers: re-check inside the transaction (friendly error) **and** a nullable unique `slotKey` on the appointment (the real guarantee). See [below](#why-a-cancelled-appointment-must-release-its-slot). |
| **Link + QR** | Every business gets a booking URL and a scannable QR code — plus one deep-link QR per service (`/book?service=…`). SVG + PNG download, print-ready poster, copy/share/embed helpers. |
| **Customer panel** | `/[locale]/my-appointments` — a signed-in customer sees every booking they made on the web, in Telegram, or at the counter, in one list, and can cancel. `/[locale]/my-appointments/<code>` is what every confirmation message links to. A visitor holding only a tracking code sees when and what but never *who*; cancelling requires being signed in as the customer or as staff. |
| **Dashboard** | KPIs (today, revenue, no-show rate, fill rate), weekly trend, service mix, status donut, per-specialist utilisation, upcoming appointments, day calendar. |
| **Operations** | Confirm / complete / no-show / cancel with a guarded state machine, reschedule (frees the old slot, reserves the new one), CSV export, waitlist with automatic offers on cancellation. |
| **Catalogue** | Categories, services (duration, buffers, informational price, colour, public/active), specialists with weekly schedules, time off, public holidays. |
| **Notifications** | Three interchangeable transports — email, **Telegram** (operational alerts to the business) and **WhatsApp** (customer confirmations, reminders, waitlist offers) — behind one contract, switched on purely by environment variables. Every message is persisted first and marked delivered only when a channel accepted it; the dashboard shows the delivery state per channel. |
| **i18n** | Full Persian (RTL) and English (LTR) catalogues, Jalali ⇄ Gregorian conversion, locale routing `/fa` `/en`, per-locale metadata, `hreflang` alternates. |
| **SEO** | Per-page metadata, canonical + alternates, OpenGraph/Twitter, JSON-LD (`Service`, `Person`, `SoftwareApplication`), dynamic sitemap, robots, web manifest, semantic headings. |
| **Security** | bcrypt (cost 12), signed httpOnly session cookie, middleware route guard, per-action rate limiting, Zod validation on every server action, RBAC, audit log, CSP + HSTS + frame/permissions headers, no secrets in the client bundle. |
| **Design** | Token-driven design system (CSS variables, light/dark), RTL-safe logical properties, Radix Slot + CVA primitives, Recharts visualisations, reduced-motion friendly. |

---

## Stack

- **Framework** — Next.js 15 (App Router, RSC, Server Actions, Middleware)
- **Language** — TypeScript (strict)
- **UI** — Tailwind CSS v4 (CSS-first `@theme`), Radix Slot, CVA, lucide-react, Recharts
- **Data** — Prisma 6 + SQLite (dev) / PostgreSQL (prod), same schema
- **Validation** — Zod (one schema per action)
- **Auth** — `jose` signed JWT in an httpOnly cookie + `bcryptjs`
- **QR** — `qrcode` rendered server-side (SVG inline, PNG via `/api/qr`)
- **Tests** — Vitest (60 unit tests: availability engine, Jalali calendar maths, series planning, package quotas, phone normalisation, slot keys) + Playwright (20 end-to-end tests against the production build and a throw-away database)

---

## Getting started

```bash
npm install
cp .env.example .env        # set AUTH_SECRET (32+ chars) and DATABASE_URL
npx prisma db push          # create the schema
npm run db:seed             # demo business: 6 services, 4 specialists, 2 branches, 2 packages, ~90 appointments
npm run dev                 # http://localhost:3000
```

| Script | Purpose |
|--------|---------|
| `npm run dev` | dev server |
| `npm run build` / `npm start` | production build & serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit suite |
| `npm run test:e2e` | Playwright suite (builds nothing — run `npm run build` first, it serves the production build on port 3210) |
| `npm run test:all` | typecheck → unit tests → build → end-to-end |
| `npm run db:push` / `db:migrate` | schema sync / migrations |
| `npm run db:seed` / `db:reset` | demo data / wipe + seed |
| `npm run verify` | smoke test of every page & the API against a running server |

### PostgreSQL

The schema is provider-agnostic. In `prisma/schema.prisma` change the datasource provider to
`postgresql`, point `DATABASE_URL` at your server and run `npx prisma db push`.
`docker-compose.yml` ships the full stack (app + Postgres 16).

---

## Project structure

```
src/
  app/
    [locale]/                 # /fa and /en share every page
      page.tsx                # landing (hero, features, pricing, testimonials, FAQ)
      book/                   # booking wizard (+ /book?service=&staff= deep links)
      services/[slug]/        # public service pages (JSON-LD)
      staff/[slug]/           # public specialist pages
      pricing/  faq/
      login/  register/
      my-appointments/        # the customer panel: own list + one appointment (view/cancel)
      dashboard/              # overview · calendar · appointments · link (QR)
        appointments.csv/     # CSV export
        services/ staff/ waitlist/ packages/ locations/ notifications/ settings/
    api/
      v1/                     # channel API: catalogue, identify, availability,
                              # appointments, cancel, packages, waitlist, support
      health/                 # readiness probe (503 when the DB is down)
      qr/                     # QR renderer (SVG/PNG, http(s) only, rate limited)
      cron/reminders/         # reminder sweep (Bearer CRON_SECRET)
    globals.css               # design tokens, base layer, utilities
    sitemap.ts robots.ts manifest.ts
  components/
    ui/                       # button, card, input, badge, dialog, table, toast, avatar…
    marketing/ booking/ dashboard/ site/ auth/
  lib/
    availability.ts           # ← pure slot engine (no DB, no React)
    availability-server.ts    # loads schedules from the DB, feeds the engine
    booking.ts                # transactional writes + double-booking guard
    slot-key.ts               # ← the "a cancellation frees the slot" rule
    channel-auth.ts           # channel secret + customer token (two credentials)
    channel-views.ts          # shared JSON shapes + localisation for every channel
    phone.ts                  # Persian digits, +98 and 0098 normalisation
    recurrence.ts             # recurring series (persisting)
    recurrence-plan.ts        # ← pure series arithmetic (unit tested)
    packages.ts packages-plan.ts   # bundles: queries vs. the rules of a "session"
    channels.ts               # email / Telegram / WhatsApp transports, one contract
    notifications.ts          # persist first, then deliver; idempotent reminders
    dates.ts                  # Jalali ⇄ Gregorian + timezone-safe civil dates
    qr.ts auth.ts validators.ts rate-limit.ts queries.ts
  middleware.ts               # locale routing + dashboard guard
prisma/schema.prisma  prisma/seed.ts
tests/                        # Vitest unit tests
e2e/                          # Playwright specs (own database, port 3210)
public/brand/                 # logo assets (mark, lockup, favicon)
```

---

## Data model

`Workspace` (tenant) → `Category` → `Service` ⇄ `StaffMember` (M:N) with `WorkingHour`,
`TimeOff`, `Holiday`; `Appointment` (unique nullable `slotKey`, tracking code, status,
buffers, reminder flags, optional `locationId`, `recurrenceGroupId`, `packagePurchaseId`);
`WaitlistEntry`, `SupportTicket`, `Notification`, `AuditLog`,
`WorkspaceMember` (OWNER/ADMIN/MANAGER/STAFF), `User`.

Two feature clusters hang off the workspace:

- **Branches** — `Location` ⇄ `StaffMember` and `Location` ⇄ `Service`. A branch without an
  explicit staffing list falls back to the whole team, so a single-branch business is
  indistinguishable from the simple case.
- **Packages** — `Package` → `PackageService` (service + quantity) → `PackagePurchase`
  (sessions bought, sessions used, expiry). Usage is counted per service, so a customer can
  mix services inside one bundle.

Statuses are strings (`PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`) so the same
schema runs on SQLite, PostgreSQL and MySQL.

---

## Notifications

`src/lib/channels.ts` defines one small contract — `send(to, subject, body)` plus an
`enabled()` probe — and three implementations:

| Channel | Enabled by | Used for |
|---------|-----------|----------|
| Email | always (logged until a provider is wired in) | confirmations, reminders |
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_IDS` | operational alerts to the business |
| WhatsApp | `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | confirmations, reminders, waitlist offers |

A missing key never breaks a booking: the channel is skipped, the failure is recorded on the
notification row, and the dashboard (`/dashboard/notifications`) shows exactly which messages
went out and which are still pending. The reminder sweep is idempotent — `reminded24hAt` /
`reminded1hAt` guarantee a reminder is sent once, however often the cron job runs.

A customer who linked a Telegram account also receives their messages **there**, so a booking
made on the website produces a Telegram message and the other way round.

---

## Channel API (the Telegram bot, and any future integration)

`/api/v1/*` is how anything that is not a browser talks to the app. Today that is the
Telegram bot in [`../appointment_bot`](../appointment_bot); tomorrow it could be WhatsApp, a
call centre, or a partner's site.

**One owner of the calendar.** A channel never keeps its own appointments or availability
logic — it asks this app and sends the customer's choice back. Two systems that each own a
calendar will eventually disagree, and that disagreement is a double booking.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/catalogue` | workspace, services, staff, branches and **labels** — one call fills the channel's whole menu |
| `POST` | `/api/v1/customers/identify` | Telegram account + mobile number → a real `User` + a customer token |
| `GET` | `/api/v1/availability` | the free slots of one day, or a heat map of the horizon |
| `POST` | `/api/v1/appointments` | book — weekly series and package sessions supported |
| `GET` | `/api/v1/appointments` | the customer's own list (`scope=upcoming\|history\|all`) |
| `POST` | `/api/v1/appointments/{code}/cancel` | cancel, then offer the freed slot to the waitlist |
| `GET` | `/api/v1/packages` | remaining prepaid sessions, per service |
| `GET` | `/api/v1/waitlist` | the caller's waitlist entries |
| `POST` | `/api/v1/waitlist` | "tell me when something frees up" |
| `POST` | `/api/v1/support` | a message into the same ticket queue the website uses |

**Two credentials, useless apart:**

```
Authorization: Bearer <CHANNEL_API_SECRET>   "I am a channel"
X-Customer-Token: <jwt>                      "…and this is the customer"
```

The channel secret is compared in constant time and the API **fails closed**: without
`CHANNEL_API_SECRET` every route answers `503 CHANNEL_NOT_CONFIGURED`, so a half-configured
deployment is never trusted. The customer token is minted by `identify` (90 days) and carries
the Telegram id, which is cross-checked against `X-Telegram-Id` — a token replayed from
another chat is refused.

**Identity adoption.** `identify` matches, in order: the same `telegramId`, then the same
phone number. The second case *adopts* the existing account, so someone who already booked on
the website keeps their history and packages instead of becoming a second, empty customer.
Numbers are normalised in `src/lib/phone.ts` (Persian digits, `+98`, `0098`, spaces), because
one person must never end up with two accounts.

Wording is served by the API (`channel.*` in the dictionary), so a channel renders the
product's own words instead of shipping a second copy of the Persian strings.

```bash
npm run channel:smoke     # 34 checks: the gate, identity, booking, cancel, packages…
```

---

## Why a cancelled appointment must release its slot

The obvious way to prevent double bookings is a unique index on
`(staffId, startsAt)`. It works — right up until the first cancellation, at which
point the row still occupies the index and **that time can never be booked
again**. The symptom is a calendar that quietly rots: customers are told a slot
is full, staff say it is empty, and nobody can find out why.

That is exactly what happened here, so reservation is modelled explicitly:

```
slotKey = "<staffId>:<startsAt as epoch ms>"    // UNIQUE, NULL when cancelled
```

`createAppointment` writes it, `updateAppointmentStatus` clears it on
cancellation, and `rescheduleAppointment` frees the old key while reserving the
new one — all in the same transaction. SQL treats `NULL`s as distinct, so a
cancelled row stops blocking its slot immediately. `@@index([staffId, startsAt])`
remains for lookups; it is deliberately *not* unique.

`src/lib/slot-key.ts` holds the rule as two pure functions, and an end-to-end
test books, cancels, then rebooks the identical instant. `scripts/backfill-slot-keys.ts`
migrated the rows that already existed.

---

## The availability engine

`src/lib/availability.ts` is intentionally pure: no database, no locale, no React. It takes
weekly windows, blocked intervals (holidays + time off), busy intervals (existing bookings
already padded with their buffers), a duration, buffers, a step, a notice window and a
horizon — and returns every slot with an availability flag and a reason (`busy`, `blocked`,
`past`, `closed`). That makes the rules testable, and the same code powers the wizard, the
calendar heat map, the dashboard utilisation numbers and the final server-side check before a
booking is written.

```
npm test          # 60 unit tests
  ✓ availability rules (buffers, breaks, notice, horizon, union, utilisation)
  ✓ calendar rules (Jalali round-trips over 400 years, Tehran offset, 24h times, RTL labels)
  ✓ series rules (weekly arithmetic across month and year boundaries, containment)
  ✓ package rules (per-service quotas, expiry, never negative)
  ✓ phone normalisation (Persian digits, +98, 0098)
  ✓ slot-key rules (holdsSlot, slotKeyOf)

npm run test:e2e  # 20 end-to-end tests
  ✓ public pages, locale switch, QR endpoint, health, protected dashboard
  ✓ guest booking, weekly series, refused series naming the exact week
  ✓ spending a package session, confirming an appointment, packages & branches pages
  ✓ customer self-service: the confirmation link opens the appointment, a stranger
    sees the time but not the customer, an unknown code is a 404
  ✓ cancelling a booking frees the slot for the next customer
```

The end-to-end suite is deliberately honest: it starts the **production build** on port 3210
against a throw-away SQLite file that it deletes, migrates and re-seeds on every run, so it can
never touch development data — and it has caught real bugs that unit tests could not see: a form
whose hidden inputs sat outside the `<form>`, a working-hours seed that stored hours as minutes,
a "must fit inside the day" check written as an intersection instead of a containment test
(which rejected *every* booking), and the slot that could never be rebooked after a cancellation.

---

## Booking flow, end to end

1. `/fa/book` → the wizard loads services and specialists.
2. Choosing a service calls `fetchMonthAction` → the server computes 45–60 days of
   availability and returns a compact `{ date → { bookable, freeCount } }` map.
3. Picking a day calls `fetchDayAction` → the exact slots, with taken ones disabled.
4. Confirming posts to `bookAppointmentAction` (Zod-validated) → `createAppointment`:
   policy check → availability re-check → transaction with an overlap re-check →
   the unique `slotKey` as the final guarantee → confirmation notification.
   With "repeat weekly" the same path creates the whole series in one transaction, and a
   package session is spent per occurrence.
5. A second customer clicking the same slot gets «این بازه هم‌اکنون رزرو شد»; for a series they
   are told which week is the problem («جلسهٔ ۳ از این سری دیگر آزاد نیست»).

---

## Link & QR

`/[locale]/dashboard/link` is the two-door page:

- **Link** — copy, open, share (Web Share API) or copy an `<iframe>` embed snippet.
- **QR** — the main booking code, plus one deep link per service so the customer lands on the
  right page. Download as SVG (crisp, small) or PNG (1024px), or print the poster
  (print styles hide the app chrome).
- The same codes are available as an API: `GET /api/qr?data=<url>&format=svg|png&size=1024`
  (http(s) only, rate limited, long cache).

---

## Security checklist

- Passwords: bcrypt, cost 12, never logged.
- Sessions: HS256 JWT (`jose`) in an `httpOnly`, `sameSite=lax` cookie, 8 h, `secure` in prod.
- Guards: middleware blocks `/dashboard` without a session; every server action re-checks the
  session **and** the workspace/role (`requireWorkspace`), because middleware alone is not a
  security boundary.
- Rate limiting: sign-in, registration and the public availability/QR endpoints.
- Validation: every action parses with Zod; the client state (service, staff, date, slot) is
  re-derived server-side and never trusted.
- Audit log: auth, bookings, catalogue and settings changes, with actor and IP.
- Headers: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `COOP`. `server-only` guards the DB/auth modules.
- `robots.txt` and `noindex` keep `/dashboard` and the auth pages out of search engines.

---

## Deployment

**Docker (recommended)**

```bash
AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
docker compose up -d --build
docker compose run --rm app npx prisma db push
docker compose run --rm app npm run db:seed
```

**Vercel / any Node host** — build with `npm run build`, start with `npm start`, set
`DATABASE_URL` (Postgres), `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, and add a daily cron hitting
`/api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`.

CI runs typecheck → unit tests → build, then the Playwright suite, then publishes the Docker
image on every push.

> ⚠️ **The workflow does not currently run.** It lives at
> `nobatyar/.github/workflows/ci.yml`, and GitHub Actions only reads
> `.github/workflows/` from the *repository* root — a workflow in a subdirectory
> is silently ignored. Move it to `.github/workflows/ci.yml` at the root and add
> `defaults: { run: { working-directory: nobatyar } }` to both jobs, and set the
> Docker build `context: ./nobatyar`. Until then, no commit has been checked.

---

## Demo content

The seed creates a realistic business, *مرکز درمان و زیبایی آریا* (Aria Health & Beauty):
3 categories, 6 services, 4 specialists with Sat–Thu schedules and lunch breaks, time off, a
public holiday, 2 branches, 2 packages with 3 purchases, 8 customers and roughly ninety
appointments across the last three weeks and the next two — so the dashboard, charts, calendar,
packages and branches all have real data on first run. The seed prints the exact counts.

| Account | Email | Password |
|---------|-------|----------|
| Owner (full dashboard) | `owner@nobatyar.app` | `Nobat#2026` |
| Manager | `manager@nobatyar.app` | `Nobat#2026` |
| Customer (owns a package) | `customer@nobatyar.app` | `Nobat#2026` |

Sign in as the customer to see the "use one of my sessions" option in the booking wizard.

---

## Roadmap

- [x] Telegram / WhatsApp channels for confirmations, reminders and team alerts
- [x] Recurring appointments, packages and prepaid session bundles
- [x] Multi-location workspaces with per-location staff and services
- [x] End-to-end suite (Playwright)
- [ ] Rooms and resources per branch (a room can be booked like a specialist)
- [ ] Online intake forms per service
- [x] Channel API for the Telegram bot (one owner of the calendar, identity adoption)
- [x] Customer self-service on the web, linked from every confirmation message
- [ ] Public API docs + webhooks (the `/api/v1` contract already exists)
- [ ] Load tests for the booking action
- [ ] SMS as a fourth transport (Iranian gateways: Kavenegar / SMS.ir)

---

© NobatYar — رزرو نوبت، به سادگی.
