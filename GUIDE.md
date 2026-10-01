# NobatYar — The Complete Guide

**Read this if you know nothing about the project.** It explains what the
product is, how to run it, every screen you can reach, how the booking engine
works, and how the Telegram bot fits in.

- Product name: **NobatYar / نوبت‌یار** — "your appointment"
- Tagline: **«رزرو نوبت، به سادگی»** — "booking an appointment, made simple"
- Language: Persian (RTL) and English (LTR), both first-class
- Dates: Jalali (شمسی), week starts Saturday, timezone Asia/Tehran, 24-hour clock

---

## Table of contents

1. [What you actually built](#1-what-you-actually-built)
2. [The one architectural decision that explains everything](#2-the-one-architectural-decision-that-explains-everything)
3. [How to run it, from zero](#3-how-to-run-it-from-zero)
4. [The links](#4-the-links)
5. [The public website, page by page](#5-the-public-website-page-by-page)
6. [Customer panel A: the website](#6-customer-panel-a-the-website)
7. [Customer panel B: the Telegram bot](#7-customer-panel-b-the-telegram-bot)
8. [Staff panel: the dashboard, page by page](#8-staff-panel-the-dashboard-page-by-page)
9. [Roles: who may do what](#9-roles-who-may-do-what)
10. [How the booking engine works](#10-how-the-booking-engine-works)
11. [Notifications](#11-notifications)
12. [The Channel API (for developers)](#12-the-channel-api-for-developers)
13. [The database](#13-the-database)
14. [Tests and verification](#14-tests-and-verification)
15. [Project layout](#15-project-layout)
16. [Troubleshooting](#16-troubleshooting)
17. [What is not built yet](#17-what-is-not-built-yet)

---

## 1. What you actually built

There are **two programs** in this folder, and they do different jobs.

```
poroje nobatdehi/
├── nobatyar/        ← the website + database + business dashboard  (Next.js)
└── appointment_bot/ ← the Telegram bot                             (Python)
```

| | `nobatyar/` | `appointment_bot/` |
|---|---|---|
| What it is | The product. Website, database, staff dashboard, and an API. | A Telegram *interface*. It shows buttons and sends taps. |
| Language | TypeScript / Next.js 15 | Python 3 / aiogram |
| Stores data? | **Yes** — the one and only database | **No** — it has no database at all |
| Who uses it | Customers (public site), staff (dashboard) | Customers, inside Telegram |
| Needs to be running for booking to work? | **Yes** | No — the bot refuses to start if the web app is down |

The bot used to have its own database, its own admin panel and its own calendar.
All of that was deleted. The bot is now a thin front-end over the web app's API.

---

## 2. The one architectural decision that explains everything

**The web app owns the calendar. The bot is just a remote control for it.**

Why this matters: if the bot and the website each kept their own appointment
list, a slot booked through Telegram would look free on the website, and you'd
get a double booking the first time both were used. Because there is exactly one
database and one booking engine, a booking made in Telegram immediately removes
that time from the website, and vice versa.

Everything else follows from that:

- The bot calls `https://your-site/api/v1/*` over HTTP and does nothing else.
- All management lives in `/dashboard`. There is no admin panel in Telegram.
- Cancelling in Telegram frees the slot for the website and the waitlist, because
  it is the *same* cancel function.

```
   customer on Telegram            customer on the web
            │                                │
            ▼                                ▼
   appointment_bot  ──── HTTP ────►   nobatyar /api/v1/*  ──►  SQLite
                                          │
                                          ▼
                                 booking engine (src/lib/booking.ts)
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
             dashboard  ◄──────  notifications  ──────►  Telegram / WhatsApp / email
```

---

## 3. How to run it, from zero

### 3.1 Prerequisites

- **Node.js 18+** (check with `node --version`)
- **Python 3.10+** (check with `python --version`)

On Windows, use `npm.cmd` rather than `npm` — PowerShell blocks `npm.ps1` by
default. That's not a project problem, it's a Windows execution-policy thing.

> If `npm install` refuses to run a postinstall script, npm 11+ requires explicit
> approval: `npm.cmd install --allow-scripts`, or approve the script when
> prompted. The Prisma engine download is the script in question.

### 3.2 The website

```powershell
cd nobatyar
npm.cmd install          # once
copy .env.example .env   # PowerShell: Copy-Item .env.example .env
```

Now open `nobatyar/.env` and fill in the values. The only ones that are
genuinely required:

```ini
DATABASE_URL="file:./dev.db"
AUTH_SECRET="<43+ random characters>"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
CHANNEL_API_SECRET="<43+ random characters>"   # only if you use the bot
```

Generate a secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`CHANNEL_API_SECRET` is the shared password between the website and the bot. If
it is missing, the entire `/api/v1/*` API answers **503 CHANNEL_NOT_CONFIGURED** —
it fails closed on purpose, so a half-configured deployment is never trusted.

Then create the database and start it:

```powershell
npm.cmd run db:push      # create tables
npm.cmd run db:seed      # fill with demo data (optional but recommended)
npm.cmd run dev          # http://localhost:3000
```

Visit **http://localhost:3000** — it redirects to `/fa`.

### 3.3 The Telegram bot

You need a bot from **@BotFather** first, and its token.

```powershell
cd appointment_bot
python -m venv ..\venv
..\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

In `appointment_bot/.env`:

```ini
BOT_TOKEN="123456:ABC-your-token-from-botfather"
WEB_API_URL="http://localhost:3000"
CHANNEL_API_SECRET="<the SAME value as in nobatyar/.env>"
PUBLIC_WEB_URL="http://localhost:3000"
```

`CHANNEL_API_SECRET` must match the website's byte for byte. If it doesn't, every
bot call returns `401` and the bot prints a clear error.

Start it — **the website must already be running**:

```powershell
python main.py
```

You should see `Bot @yourbot started`. Open Telegram, find your bot, press
**Start** (or `/start`).

> **Gotcha, already solved:** some networks advertise an IPv6 address for
> `api.telegram.org` that black-holes traffic, producing
> `Cannot connect to host api.telegram.org:443`. `channel/telegram_session.py`
> pins the connection to IPv4 to avoid it. Set `TELEGRAM_IP_FAMILY="any"` if you
> genuinely need the OS default.

### 3.4 Daily commands (website)

| Command | What it does |
|---|---|
| `npm.cmd run dev` | Development server, hot reload, at :3000 |
| `npm.cmd run build` | Production build (runs `prisma generate` first) |
| `npm.cmd run start` | Serve the production build |
| `npm.cmd run typecheck` | TypeScript, no output = clean |
| `npm.cmd test` | 60 unit tests |
| `npm.cmd run test:e2e` | 20 browser tests (builds and serves automatically) |
| `npm.cmd run test:all` | typecheck → unit → build → browser, the full gate |
| `npm.cmd run channel:smoke` | 34 checks against a **running** server |
| `npm.cmd run verify` | Page-level smoke test |
| `npm.cmd run db:studio` | Browse the database in a GUI |
| `npm.cmd run db:reset` | Wipe and re-seed (destructive) |
| `npm.cmd run abstract` | Re-render the graphical abstract PNG |

> `npm run build` fails with `EPERM` if the dev server is running, because
> Prisma's query-engine DLL is locked by the running process. Stop the dev
> server first.

### 3.5 Daily commands (bot)

```powershell
..\venv\Scripts\python.exe -m pytest          # 18 unit tests + 3 live tests
..\venv\Scripts\python.exe main.py            # run the bot
```

---

## 4. The links

Everything lives on `http://localhost:3000` locally. Set
`NEXT_PUBLIC_APP_URL` to your real domain and every link, QR code and message
follows automatically.

### The two doors for customers

`/fa/dashboard/link` (**لینک و QR**) generates the shareable links and QR codes:

| | URL | Use it for |
|---|---|---|
| Main booking page | `http://localhost:3000/fa/book` | The QR on your shop window, Instagram bio, business card |
| Per-service deep link | `http://localhost:3000/fa/book?service=<id>` | A poster for one specific treatment — scanning lands straight on that service |

The Telegram bot is the third door: **@sdvethykyulkybot**.

### Every page that exists

**Public (no sign-in needed)**

| URL | What it is |
|---|---|
| `/fa` or `/en` | Home |
| `/fa/services` | Service catalogue with prices and durations |
| `/fa/services/<slug>` | One service in detail |
| `/fa/staff` | The team |
| `/fa/staff/<slug>` | One specialist, their services and availability |
| `/fa/book` | **The booking wizard** |
| `/fa/pricing` | Subscription tiers of the product itself |
| `/fa/faq` | Questions |
| `/fa/login`, `/fa/register` | Sign in / sign up |
| `/fa/my-appointments` | The customer's own list (needs sign-in) |
| `/fa/my-appointments/<code>` | One appointment, with a cancel button |
| `/fa/dashboard` | The staff panel (needs sign-in) |

The `fa` / `en` prefix is the language. `fa` is right-to-left, `en` is
left-to-right, and the switch in the header keeps your place.

**API**

| URL | Purpose |
|---|---|
| `/api/health` | Liveness, plus row counts — good for uptime checks |
| `/api/qr` | Renders a QR code as SVG for any booking URL — for embedding in your own site |
| `/api/v1/*` | The channel API (10 endpoints) — see [section 12](#12-the-channel-api-for-developers) |
| `/api/cron/reminders` | The reminder sweep — see [section 11](#11-notifications) |

### Demo accounts (after `db:seed`)

| Account | Password | Sees |
|---|---|---|
| `owner@nobatyar.app` | `Nobat#2026` | Everything, as the business owner |
| `customer@nobatyar.app` | `Nobat#2026` | A customer account with booking history and a package |

---

## 5. The public website, page by page

### The booking wizard — `/fa/book`

One page, three steps, no page reloads:

1. **Pick a service.** Category chips, then the service. If you arrived from a
   deep link (`?service=…`) that step is skipped. If you are signed in and own a
   prepaid package, a package selector appears here.
2. **Pick a time.** Choose a specialist (or "nearest free"), then a day from a
   horizontal Jalali strip, then a slot. Only genuinely free slots are shown.
3. **Confirm.** Name, phone, optional notes, optional package. On success you get
   a tracking code like `APT-KW33D`.

Timezone is Asia/Tehran throughout, the clock is 24-hour, and the week starts on
Saturday.

### Home page

Hero with the booking call-to-action, the service highlights, the team, and the
how-it-works strip. Fully bilingual and fully responsive, with a dark mode.

---

## 6. Customer panel A: the website

Two pages, both under **نوبت‌های من / My appointments**, linked from the header
when you're signed in.

### `/fa/my-appointments` — the list

Every appointment you have made, **however you made it**: on the website, through
the Telegram bot, or by phone at the counter. It's all one record, so it all
shows up here. Split into *upcoming* and *history*, 25 each, each row showing the
service, date, time, specialist, branch, status and tracking code. Clicking a row
opens that appointment.

### `/fa/my-appointments/<code>` — one appointment

**This is the page every confirmation message links to.** Telegram, WhatsApp and
email confirmations all point here, so it must never 404.

It has two deliberately different states:

| Who you are | What you see | What you can do |
|---|---|---|
| **Signed in as the customer** (or as staff of the business) | Everything: the customer's phone number and their notes | **Cancel** the appointment |
| **Just someone with the link** | When, what, which specialist, which branch, the status, the tracking code | Nothing — just a "sign in" prompt |

The asymmetry is on purpose. A tracking code is five characters; treating it as a
password would be false comfort, so personal data is gated behind a real sign-in
rather than behind a guessable string. Lookups are rate-limited.

Cancelling from here releases the slot for the waitlist, exactly like cancelling
anywhere else.

---

## 7. Customer panel B: the Telegram bot

Start it with `/start` (or the Start button). The bot is a guided, button-driven
flow — no typing needed at any step.

### What it does

The home screen is four buttons:

| Button | What happens |
|---|---|
| **🗓 رزرو نوبت جدید / Book** | Service → specialist → day → time → confirm, all as buttons. Mirrors the website wizard, backed by the same engine |
| **📋 نوبت‌های من / My appointments** | Your upcoming and past appointments; cancellable ones get a cancel button |
| **🎁 بسته‌های من / My packages** | Your prepaid packages and how many sessions are left on each |
| **💬 پشتیبانی / Support** | Sends a support message that lands as a ticket in the dashboard |
| **🌐 رزرو در وب‌سایت / Book on the website** | Hands you off to the web app — for anything the bot doesn't do |

And the first run is a short registration:

| Step | What happens |
|---|---|
| **Start** | Greets, and offers to use the phone number Telegram already knows for you |
| **Registration** | Sends you to the website to confirm your phone (Telegram can't be trusted to *prove* a phone number on its own), then **adopts your existing account** so your web history and packages come with you |

### What it deliberately does not do

There is no admin panel, no staff management, no calendar editing in Telegram.
Everything the business needs to manage is in `/dashboard`, on the web, where it
belongs.

### Localised copy

All the bot's Persian and English text comes from the **web app**, not from the
bot (`channel.*` in `src/lib/dictionaries.ts`). Change a phrase in one place and
both the website and the bot change it.

---

## 8. Staff panel: the dashboard, page by page

`/fa/dashboard` — the sidebar has 11 sections.

| # | Page | What it does |
|---|---|---|
| 1 | **نمای کلی / Overview** | Today's KPI tiles, charts (bookings over time, revenue by service, status breakdown), and today's appointment list |
| 2 | **تقویم / Calendar** | A week/day grid of every staff member's week, colour-coded by status. Drag to reschedule. |
| 3 | **نوبت‌ها / Appointments** | The full list, with filters (status, service, staff, customer, date), search, CSV export, and inline actions: confirm, complete, no-show, cancel, reschedule |
| 4 | **خدمات / Services** | Create and edit services: name (fa + en), category, duration, price, buffer before/after, which specialists can perform it, min/max notice, active/public flags |
| 5 | **کارشناسان / Staff** | Add specialists, assign them to services, set their weekly working hours, per-day hours and time off |
| 6 | **لیست انتظار / Waitlist** | Customers who wanted a time that was taken. When a slot frees, the first matching entry is offered automatically |
| 7 | **لینک و QR / Link & QR** | The main booking link and QR, plus one deep-link QR per service. Downloadable, printable |
| 8 | **بسته‌ها / Packages** | Prepaid bundles: a set of service sessions sold at a discount, with a price and a validity period |
| 9 | **شعبه‌ها / Locations** | Multiple branches, each with its own address, hours and phone. Availability is computed **per branch** |
| 10 | **اعلان‌ها / Notifications** | The delivery log: every message that was sent, over which channel, whether it succeeded, with a resend button |
| 11 | **تنظیمات / Settings** | Business name (fa + en), timezone, currency, slot length, notice window, holiday calendar |

A **CSV export** of the appointment list lives at
`/fa/dashboard/appointments.csv`.

---

## 9. Roles: who may do what

Four workspace roles, stored on the membership:

| Role | Sees the dashboard | Manages services, staff, hours, holidays, packages, locations | Deletes a service, package, location, or changes settings |
|---|---|---|---|
| **OWNER** (مالک) | yes | yes | yes |
| **ADMIN** (مدیر) | yes | yes | yes |
| **MANAGER** (سرپرست) | yes | yes | no |
| **STAFF** (کارشناس) | yes | no | no |

**An honest caveat about how this is enforced.** Page *visibility* is not
filtered by role — any signed-in user can load any dashboard page. What is
enforced is the **server action** behind every button: each one re-checks the
caller's role before touching the database. So a staff member who hand-types the
URL of the packages page sees the page, but every save button on it returns
"unauthorised" and nothing changes. This is the safe default (the real gate is
at the mutation, not the menu), but it does mean the sidebar shows staff members
more links than they can use.

One more note for whoever maintains this: `canManage()` exists in
`src/lib/auth.ts` but is currently called from nowhere. The role checks are done
by passing the allowed roles to `requireWorkspace(locale, ["OWNER","ADMIN"])`.
Either wire `canManage()` into the sidebar or delete it — right now it is dead
code that suggests a protection that isn't there.

---

## 10. How the booking engine works

This is the part worth understanding, because it's where a booking system
usually goes wrong.

### 10.1 Availability is computed, never stored

A slot is *available* if a specialist works at that time, the service fits
(duration + buffers), nothing overlaps an existing appointment, no time-off or
holiday blocks it, it's inside the booking-notice window, and — for packages —
the customer has a session left. Available slots are derived on the spot from
those rules, so the website and the bot can never disagree about what is free.

### 10.2 Reservation is one nullable column

When a booking is made, the appointment row gets a `slotKey`:

```
slotKey = "<staffId>:<startsAt as epoch milliseconds>"
```

`slotKey` is `UNIQUE`, and it is **`NULL` when the appointment is cancelled**.

This single design decision is the fix for a bug that plagues booking systems.
The obvious approach is a unique index on `(staffId, startsAt)`. It works right up
until someone cancels — and then the row still occupies that index, so **that
time can never be booked again, ever**. The calendar quietly rots. Because
cancellations set the key to `NULL` (and SQL treats `NULL`s as distinct), the slot
is genuinely free again.

There's a regression test for exactly this — *"cancelling a booking frees the slot
for the next customer"* — because it already bit us once.

### 10.3 Recurring bookings

Weekly series from 1 to 12 weeks, **all or nothing**: if week 5 has no free slot,
the whole series is refused and the error names the exact week that failed,
rather than silently booking 4 of 5.

### 10.4 Prepaid packages

A package is a bundle of N sessions of specific services. Buying one creates a
purchase; each booking **atomically decrements** the remaining count. Two people
racing for the last session cannot both win.

### 10.5 Multiple branches

Each `Location` has its own hours. Availability is branch-scoped, so a
specialist who only works at one branch on Tuesday doesn't show up at the other.

### 10.6 Waitlist

When someone tries to book a full slot, they can join the waitlist. The moment a
matching slot is released (by a cancellation, or a reschedule), the first matching
entry is notified automatically.

### 10.7 Rescheduling

Rescheduling frees the old slot and reserves the new one in the same operation,
so a "move my appointment" can never leave a double booking or a phantom lock.

---

## 11. Notifications

Three transports, all optional — **a missing key disables that channel, and
nothing else**:

| Channel | Configured by | Sends |
|---|---|---|
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_IDS` | Operational alerts to the business, and confirmations to the customer (their Telegram ID is resolved from their user record automatically) |
| **WhatsApp** | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Customer confirmations, reminders, waitlist offers |
| **Email** | `RESEND_API_KEY` or `SMTP_URL` | The same messages. With no provider configured, messages are **logged instead of sent** rather than failing loudly |

Message kinds: booking confirmed, cancelled, rescheduled, reminder at 24 hours,
reminder at 1 hour, waitlist offer, and staff alerts.

### Reminders

Reminders come from one idempotent sweep you can call from any scheduler:

```
GET /api/cron/reminders
Authorization: Bearer $CRON_SECRET
```

Call it every 15 minutes or so. It is safe to call repeatedly and even in
parallel: the `reminded24hAt` / `reminded1hAt` columns guarantee each reminder
goes out **exactly once**. In development the route is open if `CRON_SECRET` is
unset; in production it is not.

Every delivery attempt is recorded and visible at `/fa/dashboard/notifications`,
so when a customer says "I never got the message" you can actually find out.

---

## 12. The Channel API (for developers)

Ten endpoints under `/api/v1`, all JSON, all bilingual via `?locale=fa|en`.

| Route | What it does |
|---|---|
| `GET /catalogue` | Services, categories, staff, branches, packages |
| `POST /customers/identify` | Find or create a customer; returns a customer token |
| `GET /availability` | Either a single day (`?date=`) or a range (`?days=`) |
| `GET /appointments` | The customer's appointments |
| `POST /appointments` | Book (supports recurring series and packages) |
| `POST /appointments/<code>/cancel` | Cancel — releases the slot |
| `GET /packages` | Packages and the caller's remaining sessions |
| `GET /waitlist` | The caller's waitlist entries |
| `POST /waitlist` | Join the waitlist for a time that is taken |
| `POST /support` | Raise a support ticket from a channel |

### Authentication — two credentials, because they answer two different questions

```
Authorization: Bearer <CHANNEL_API_SECRET>    # "which integration is this?"
X-Customer-Token: <jwt>                        # "which customer is this?"
X-Telegram-Id: <id>                            # must match the token's subject
```

- The **channel secret** proves the caller is an integration you trust. It's a
  shared bearer token; rotate it by changing it in both `.env` files.
- The **customer token** is a 90-day HS256 JWT minted by `identify`. It is
  cross-checked against `X-Telegram-Id`, so a stolen token is useless without
  also being the claimed Telegram account.
- If `CHANNEL_API_SECRET` is missing, the whole API answers
  `503 CHANNEL_NOT_CONFIGURED` rather than quietly allowing anonymous access.

### `identify` adopts rather than duplicates

It matches on `telegramId` first, then on phone number, and when it finds an
existing account it **adopts** it — so a customer who already used the website
keeps their history and their packages when they start using the bot. Without
this, everyone would end up with two half-accounts.

### Try it

```powershell
$env:H = @{ Authorization = "Bearer <your CHANNEL_API_SECRET>"; "Content-Type" = "application/json" }
curl.exe -s -H "Authorization: Bearer <secret>" "http://localhost:3000/api/v1/catalogue?locale=fa"
```

Or run the 34-check suite, which needs the server already running:

```powershell
npm.cmd run channel:smoke
```

---

## 13. The database

SQLite via Prisma, and Postgres-ready — change `DATABASE_URL` and the schema
ports. Tables:

| Table | Holds |
|---|---|
| `User`, `Session`, `Account` | Accounts. `User` carries `phone`, `telegramId`, `telegramUsername`, `whatsappPhone` |
| `Workspace`, `WorkspaceMember` | The business and who works there, with their role |
| `Service`, `Category` | What's on offer, with `name` + `nameFa` everywhere |
| `Staff` | Specialists, their services, hours, time off |
| `Location` | Branches |
| `Appointment` | The bookings. **`slotKey` is the reserved slot** |
| `AvailabilityRule`, `TimeOff`, `Holiday` | Working hours, absences, holidays |
| `Package`, `PackageService`, `PackagePurchase` | Prepaid bundles and what's left on them |
| `WaitlistEntry` | People waiting for a slot |
| `Notification` | The delivery log |
| `SupportTicket` | Tickets raised from any channel |
| `RecurrenceGroup` | Ties a weekly series together |

Every user-facing name is stored twice (`name` / `nameFa`) so the app can be
genuinely bilingual rather than machine-translated at render time.

Explore it visually with `npm.cmd run db:studio`.

---

## 14. Tests and verification

| Suite | Count | Command |
|---|---|---|
| Unit (Vitest) | 60 | `npm.cmd test` |
| End-to-end (Playwright, Chromium) | 20 | `npm.cmd run test:e2e` |
| Channel API smoke | 34 checks | `npm.cmd run channel:smoke` |
| Page smoke | — | `npm.cmd run verify` |
| Bot unit + mock-transport | 18 | `..\venv\Scripts\python.exe -m pytest` |
| Bot live journey | 3 | same, needs the web app running |

The full gate, which is what CI runs:

```powershell
npm.cmd run test:all
```

The E2E suite covers the things that actually broke in development, as
regression guards: cancelling frees the slot; a stranger can't cancel someone
else's appointment; a non-existent tracking code is a 404 and not a blank page;
the link in a confirmation message opens the appointment.

---

## 15. Project layout

```
nobatyar/
├── prisma/schema.prisma        the whole data model
├── src/
│   ├── app/
│   │   ├── [locale]/           all pages, fa + en
│   │   │   ├── book/           the booking wizard
│   │   │   ├── dashboard/      the 11 staff pages
│   │   │   └── my-appointments/  the customer panel
│   │   ├── api/v1/              the 9 channel routes
│   │   ├── actions/            server actions (the real permission gate)
│   ├── components/             UI (ui/ primitives, site/ public, dashboard/)
│   ├── lib/
│   │   ├── booking.ts          create / reschedule / cancel  ← the engine
│   │   ├── availability.ts      slot computation
│   │   ├── slot-key.ts         the "cancel frees the slot" rule
│   │   ├── channel-auth.ts     the two-credential gate
│   │   ├── channel-views.ts    shared JSON shapes + localisation
│   │   ├── notifications.ts    the send pipeline
│   │   ├── dictionaries.ts     every Persian and English string
│   │   └── dates.ts            Jalali
│   └── ...
├── scripts/                    channel-smoke, verify, render-abstract, backfill
└── e2e/specs/app.spec.ts       the browser tests

appointment_bot/
├── main.py                     entry point
├── channel/api.py              the ONLY file that talks to the web app
├── channel/text.py             localised strings (mirrors the app)
├── channel/telegram_session.py IPv4 pin
├── handlers/                   start, registration, booking, my_appointments, profile
└── tests/                      unit, mock-transport, live
```

---

## 16. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm` won't run at all | PowerShell blocks `npm.ps1`. Use `npm.cmd`. |
| `EPERM` during `npm run build` | The dev server is running and holding Prisma's DLL. Stop it first. |
| Channel API returns 503 everywhere | `CHANNEL_API_SECRET` is missing in `nobatyar/.env`. |
| Bot gets 401 on every call | The two `CHANNEL_API_SECRET` values differ, or the `.env` wasn't reloaded. |
| `Cannot connect to host api.telegram.org:443` | IPv6 black hole. Keep `TELEGRAM_IP_FAMILY="ipv4"`. |
| Bot refuses to start | By design — it won't run without a reachable web app. Start `npm run dev` first. |
| "no production build" from Playwright | Run `npm.cmd run build` first, or just use `npm.cmd run test:all`. |
| `channel:smoke` gets ECONNREFUSED | The server isn't running. It's a script against a live app, not a unit test. |
| Telegram menus look wrong | Stale message text in an old conversation — press `/start` again to get the current keyboards. |

---

## 17. What is not built yet

Stated plainly, so nothing here is a surprise:

- **Rooms, chairs and equipment.** A location knows its hours but not its
  physical capacity, so two services can't compete for one treatment room.
- **Intake forms.** No custom questions per service yet.
- **SMS.** Telegram, WhatsApp and email work; SMS (Kavenegar, SMS.ir) does not.
- **Public API docs and webhooks.** The channel API works and is documented in
  code, but there's no hosted reference or outbound webhooks.
- **Payments.** Packages are sold and consumed, but there's no payment gateway.
- **Load testing.** Correct under test load; not yet measured under real load.
- **Multi-tenant hosting.** The schema is multi-tenant and the code reads from a
  single workspace, but only one workspace is ever served.

---

*NobatYar — «رزرو نوبت، به سادگی»*
