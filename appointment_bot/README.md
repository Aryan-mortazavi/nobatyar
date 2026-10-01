# 🤖 NobatYar Telegram Bot

> 📖 **New here?** Read the [Complete Guide](../GUIDE.md).

> A **channel** in front of the [NobatYar](../nobatyar) web application.

This bot lets customers book, review and cancel appointments **inside Telegram**,
while the web application stays the single owner of the calendar, the management
panels and the customer records.

```
   Telegram  ──►  this bot  ──HTTP──►  NobatYar /api/v1  ──►  database
   customer  ──────────────────────►  the same database
                                                    │
                              /dashboard ◄───────────┘   (owners & staff)
```

## Why it is only a channel

Two systems that each keep their own calendar will eventually disagree — and
the disagreement shows up as a double booking, at 3pm on a busy Saturday. So:

* this bot has **no database**, no availability logic and no business rules;
* it asks the web app what is true (`GET /api/v1/availability`) and sends the
  customer's choice back (`POST /api/v1/appointments`);
* the web app answers with the *same* `createAppointment` the website uses, so
  the re-check, the transaction and the unique slot reservation all apply.

An appointment booked in Telegram appears in `/dashboard` immediately, and
cancelling it in the dashboard sends the customer a Telegram message.

## What a customer can do

| Screen | What happens |
|--------|--------------|
| `/start` | Greeted; if already identified, straight to the menu |
| 🗓 رزرو نوبت جدید | service → specialist (or ⚡️ earliest free) → Jalali date → time → confirm |
| 📋 نوبت‌های من | upcoming and past appointments, with cancellation |
| 🎁 بسته‌های من | remaining prepaid sessions, per service |
| 💬 پشتیبانی | a message that lands in the web app's ticket queue |
| 🌐 رزرو در وب‌سایت | deep link with the service pre-selected |

The wording of every button comes from the **web app** (`channel.*` in its
dictionary), so the product speaks with one voice; the strings in this repo are
only Telegram's own chrome.

## Setup

```bash
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

`.env`:

```ini
BOT_TOKEN=…                 # from @BotFather
WEB_API_URL=http://localhost:3000
CHANNEL_API_SECRET=…        # the SAME value as the web app's CHANNEL_API_SECRET
PUBLIC_WEB_URL=http://localhost:3000
TELEGRAM_IP_FAMILY=ipv4     # see "Networks" below
```

The web app must be running and `CHANNEL_API_SECRET` must match on both sides —
the bot **refuses to start** otherwise, because a bot that books against a dead
service silently eats customers' requests.

```bash
python main.py
```

## Networks

Some hosts (Windows servers, containers) advertise an IPv6 address that
black-holes, which makes Telegram look unreachable:

```
ClientConnectorError: Cannot connect to host api.telegram.org:443
[The semaphore timeout period has expired]
```

`channel/telegram_session.py` pins the address family the bot dials. Default
`ipv4`; set `TELEGRAM_IP_FAMILY=any` to restore the OS behaviour.

## Tests

```bash
pytest                      # everything
pytest tests/test_channel_api.py    # the client, against a mock transport
pytest tests/test_live_channel.py   # the real flow, against a running web app
```

The unit suite never touches the network. The live suite runs the real customer
journey (identify → look → book → see → cancel) against whatever
`WEB_API_URL` points at, and is skipped when that is not configured.

## Layout

```
channel/
  api.py               # the HTTP client — the only thing that talks to the web app
  session.py           # per-chat state: the customer token, the catalogue cache
  runtime.py           # the shared client instance (created at start-up)
  telegram_session.py  # address-family tuning for aiohttp
  text.py              # Persian formatting
handlers/              # common · start · registration · booking · my_appointments · profile
keyboards/             # reply + inline keyboards
utils/calendar.py      # Jalali helpers (pure)
tests/
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/catalogue` | workspace, services, staff, branches, labels — one call fills the menu |
| `POST` | `/api/v1/customers/identify` | Telegram account + phone → a real customer + a token |
| `GET` | `/api/v1/availability` | free slots of a day, or a heat map of the horizon |
| `POST` | `/api/v1/appointments` | book (supports weekly series and package sessions) |
| `GET` | `/api/v1/appointments` | the customer's own list (`scope=upcoming\|history\|all`) |
| `POST` | `/api/v1/appointments/{code}/cancel` | cancel, then offer the slot to the waitlist |
| `GET` | `/api/v1/packages` | remaining sessions, per service |
| `POST` | `/api/v1/waitlist` | "tell me when something frees up" |
| `POST` | `/api/v1/support` | a message into the web app's ticket queue |

Authentication is two credentials that are useless apart:
`Authorization: Bearer <CHANNEL_API_SECRET>` (I am the bot) plus
`X-Customer-Token` (…and this is the customer).
