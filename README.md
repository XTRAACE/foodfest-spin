# 🎡 FOOD FEST — Smart Lucky Spin System

A complete, production-shaped full-stack lucky-spin system for a food festival: public customer
registration, automatic groups of three, cryptographically random customer selection, weighted prize
selection, a 360° digital wheel, a physical ESP32 machine with a 180° servo arrow, OLED + TM1637
displays, DEMO and REAL operating modes, prize stock accounting, reports and an audit log.

**The backend is the single source of truth.** The browser and the ESP32 never pick a prize — they only
animate to an angle the backend already decided.

---

## 1. Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, Lucide icons |
| Backend | Node.js, Express, TypeScript, Zod validation, JWT auth |
| Database | PostgreSQL — Supabase in production, embedded PostgreSQL (PGlite) for local dev |
| Realtime | Server-Sent Events (`/api/events`) for dashboards |
| Hardware | ESP32 + SH1106 OLED + TM1637 4-digit display + 180° servo + joystick button |

## 2. Repository layout

```
├── server/                     REST API
│   ├── db/migrations/001_init.sql     full PostgreSQL schema
│   └── src/
│       ├── db/                 Postgres + PGlite drivers, migration runner
│       ├── lib/                CSPRNG selection, errors, DTO mapping, event bus
│       ├── middleware/         JWT admin guard, role guard, device token guard
│       ├── routes/             auth, public, admin, device, SSE events
│       ├── services/           customers, groups, prizes, spins, devices, stats, demo, bootstrap
│       └── scripts/            migrate, seed, verify-logic, smoke
├── web/                        React application
│   └── src/pages/              registration, login, dashboard, customers, groups, prizes,
│                               lucky spin, hardware, history, settings
├── firmware/foodfest_spin/     ESP32 Arduino firmware (.ino)
└── docs/                       API.md, TESTING.md
```

## 3. Quick start (works with no external accounts)

```bash
npm install
cp .env.example .env          # optional: defaults already work
npm run dev
```

- Web app: **http://localhost:5173** — mobile registration at `/`, customer wheel at `/spin`, admin at `/admin`

Customer flow (mobile-first): register → every third registration completes a group and the backend
randomly picks one member → the site announces the winner in a popup with text-to-speech and the ESP32
shows the same customer → the popup button opens `/spin`, which spins the wheel with sound and announces
the prize. The ESP32 and the phone can both trigger/complete the same spin safely (idempotent).
- API: **http://localhost:4000**

First boot creates the schema, an admin account and demo data automatically.

| What | Value |
|---|---|
| Admin email | `admin@foodfest.local` (from `ADMIN_EMAIL`) |
| Admin password | `admin12345` (from `ADMIN_PASSWORD`) — set a real one before the event |
| Device ID | `FOODFEST_ESP32` |
| Device token | `dev-device-token-change-me` (from `DEVICE_TOKEN`) |

Leave `DATABASE_URL` empty and the API runs an embedded PostgreSQL in `server/.data/pglite` using the
**exact same SQL migrations** as Supabase. Nothing is mocked: registration, grouping, weighted selection,
stock locking, idempotent completion and the device API all run for real.

### Individual commands

```bash
npm run dev:server     # API only (tsx watch)
npm run dev:web        # frontend only
npm run db:migrate     # apply SQL migrations
npm run seed           # create admin/prizes/device/demo data if missing
npm run typecheck      # server + web
npm run build          # compile API and build the frontend
```

## 4. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Project Settings → Database → **Connection string** → copy the URI (session pooler, port 5432).
3. Put it in `.env`:

```env
DATABASE_URL=postgresql://postgres.XXXX:YOUR-PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

4. `npm run seed` (or just start the API — migrations and bootstrap run on boot).

The full schema (`server/db/migrations/001_init.sql`) mirrors the design in section 12 of the brief:
`customers`, `customer_groups`, `group_selections`, `prizes`, `prize_stock`, `spins`,
`prize_stock_transactions`, `devices`, `device_commands`, `admin_users`, `event_settings`, `audit_logs`,
plus `counters` for gap-free sequential numbering.

**About authentication:** admin sign-in is implemented in the API (bcrypt password hashes + short-lived
JWTs + `admin`/`operator` roles) instead of Supabase Auth. That is deliberate: the ESP32 needs a separate
device credential, admin routes need server-side role checks, and this path works identically on Supabase
Postgres and local Postgres without extra credentials. The database, transactions and constraints are all
Supabase PostgreSQL. If you prefer Supabase Auth, verify the Supabase JWT in
`server/src/middleware/auth.ts` and map its email to `admin_users` — nothing else needs to change.

## 5. How a spin is guaranteed fair

```
Registration → counter row locked (FOR UPDATE) → 001, 002, 003 ...
Group of three complete? → crypto.randomInt chooses ONE member → group_selections (unique per group)

Spin request ──► OPEN TRANSACTION
                 1. verify the selected customer / group / mode / event state
                 2. read eligible prizes (enabled, weight > 0, stock − pending > 0)
                 3. weighted CSPRNG pick: weight / totalWeight
                 4. compute wheel angle + calibrated servo angle
                 5. INSERT spins (pending) with prize + probability snapshot
                COMMIT  ← prize is now frozen in the database
                          │
        ┌─────────────────┴──────────────────┐
   Digital wheel (rotation to backend angle)   ESP32 (servo to backend servo angle)
        └─────────────────┬──────────────────┘
                          ▼
             POST /spin/complete (idempotent)
             → status=completed, stock −1 exactly once
             → prize_stock_transactions row (unique per spin)
```

Guarantees enforced by the database, not just by code:

- `unique (mode, customer_number)` and a locked counter → no duplicate customer numbers
- `group_selections.group_id UNIQUE` → one selected customer per group
- `group_selections.customer_id UNIQUE` → a customer can never be selected twice
- partial unique index `spins (customer_id) WHERE mode='real'` → one real spin per customer
- `spins.spin_code UNIQUE` and `spins.idempotency_key UNIQUE` → retries never create extra spins
- `prize_stock_transactions.spin_id UNIQUE` + `stock >= 0` check → no negative stock, no double deduction
- `spins` is only marked `completed` by the completion endpoint; the prize snapshot never changes

Pending spins survive a Wi-Fi drop: the device retries `/spin/start` with the same `spin_id`
(idempotency key) and `/spin/complete`; a pending spin can be resumed or cancelled through the API.

## 6. DEMO vs REAL

| | DEMO | REAL |
|---|---|---|
| Customers | 9 seeded sample customers, reset any time | public registrations with sequential numbers |
| Stock | separate `prize_stock.mode='demo'` rows | `mode='real'` rows |
| Spins | `spins.mode='demo'`, repeatable, never one-per-customer | `mode='real'`, one per selected customer |
| Reset | **Reset demo** rebuilds demo data, demo stock and clears demo history | never touched by demo actions |
| UI | DEMO watermark + amber badge | green REAL badge |

Switch modes in **Admin → Event settings**.

## 7. Physical machine (ESP32)

Wiring (fixed in firmware):

| Component | ESP32 pin |
|---|---|
| OLED SDA | GPIO 21 |
| OLED SCL | GPIO 22 |
| TM1637 CLK | GPIO 18 |
| TM1637 DIO | GPIO 19 |
| Servo signal | GPIO 23 |
| Joystick SW (INPUT_PULLUP, pressed = LOW) | GPIO 32 |

Arduino libraries: **U8g2**, **TM1637Display**, **ESP32Servo**, **ArduinoJson**.

Edit the constants at the top of `firmware/foodfest_spin/foodfest_spin.ino`:

```cpp
const char *WIFI_SSID     = "...";
const char *WIFI_PASSWORD = "...";
const char *API_BASE      = "https://your-server.example.com";  // or http://192.168.1.10:4000
const bool  API_USE_HTTPS = true;
const char *DEVICE_TOKEN  = "...";   // must equal DEVICE_TOKEN in .env
```

Behaviour:

- Heartbeat every 15 s, `GET /api/device/current` every ~1.2 s, command poll every 4 s, Wi-Fi auto-reconnect.
- Shows group-selected customer on the OLED and the customer number on the TM1637.
- Joystick press → `POST /api/device/spin/start` with a per-press idempotency key → arrow animates inside
  the calibrated range → `POST /api/device/spin/complete` (3 retries).
- The firmware clamps every servo move to `SERVO_MIN_ANGLE..SERVO_MAX_ANGLE` (15°–165° by default) so the
  arm never hits the mechanical stops. The arrow sweeps both directions with decreasing speed and lands
  exactly on the backend angle — it never chooses a prize.
- The wheel angle → servo mapping uses the global servo range in settings and each prize's optional
  `servoAngle` (set through `PATCH /admin/prizes/:id`), and is returned by the API as `target_angle`.

Use a **lightweight arrow** and a servo with enough torque; power the servo from a separate 5 V supply with
a common ground.

## 8. Environment variables

| Name | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | allowed browser origins |
| `JWT_SECRET` | dev fallback | **change in production** |
| `JWT_EXPIRES_IN` | `12h` | admin session lifetime |
| `DATABASE_URL` | empty | Supabase/Postgres URI; empty → embedded PGlite |
| `PGLITE_PATH` | `./.data/pglite` | local database directory |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `admin@foodfest.local` / `admin12345` | first admin |
| `DEVICE_TOKEN` | `dev-device-token-change-me` | ESP32 shared secret (hashed at rest) |
| `DEVICE_ID` | `FOODFEST_ESP32` | machine identifier |

`.env` is git-ignored. Nothing secret is ever sent to the browser: the frontend uses only the admin JWT, and
the device token is checked server-side (`x-device-token`, SHA-256 hash comparison, `timingSafeEqual`).

## 9. Security summary

- Admin routes require a signed JWT; configuration changes require the `admin` role (`operator` can spin).
- Passwords stored as bcrypt hashes; admin login is audited.
- Every input validated with Zod; all SQL uses bound parameters.
- Multi-row changes (group selection, spin creation, stock deduction) run in transactions with row locks.
- Stock can never go negative, and a spin's stock transaction is unique.
- Demo operations are hard-scoped to `mode='demo'`.
- Full audit log for admin/prize/settings/device changes (`GET /admin/audit`).

## 10. Testing

```bash
npm run typecheck
npm --workspace server run verify:logic   # weighted + uniform CSPRNG checks
npm --workspace server run smoke          # 68-check end-to-end API test (needs a server)
```

See **[docs/TESTING.md](docs/TESTING.md)** for the full manual checklist (including the 20 required
scenarios and the hardware-only checks) and **[docs/API.md](docs/API.md)** for the API reference.

## 11. What needs external resources / physical hardware

| Item | Status |
|---|---|
| Supabase project + `DATABASE_URL` | optional — the app runs fully on embedded PostgreSQL without it |
| HTTPS certificate for the API | required in production so the ESP32 can use `https://` (ESP32 `setInsecure()` is used in the sample; pin a CA for real deployments) |
| ESP32 + SH1106 + TM1637 + servo + joystick | required for the physical arrow, OLED and four-digit display |
| Servo angle calibration | must be tuned on the real machine (prize `servoAngle` via the API) |
| Wi-Fi credentials | flash into the firmware |

Everything else — registration, grouping, random selection, probability, stock, history, reports,
authentication, demo mode and the digital wheel — is fully implemented and verified locally.

## 12. Hosting

The full step-by-step deployment guide (database, environment variables, build/start commands, domain,
HTTPS, ESP32 pointing at the live URL and go-live checks) is in **[docs/HOSTING.md](docs/HOSTING.md)**.

Short version — one Node service + one Postgres database is enough:

```bash
npm ci
npm run build
npm --workspace server run start   # serves the API and web/dist on PORT
```

Set `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, `DEVICE_TOKEN` and `CORS_ORIGINS` on the host.
Migrations and seeding run automatically on first boot. Hosts that only run static files or Cloudflare
Workers cannot host this API — use Render, Railway, Fly.io or a small VPS.
