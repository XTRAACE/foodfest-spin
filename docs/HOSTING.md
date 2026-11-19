# Hosting — Food Fest Lucky Spin

The app is two parts:

| Part | What it is | Needs |
|---|---|---|
| `server/` | Express API (JWT admin auth, spins, device API, SSE) | Node.js 20+, PostgreSQL |
| `web/` | React build (`web/dist`) | static files |

The API already serves `web/dist` when it exists, so **one Node service + one Postgres database is a
complete deployment** — no separate static host is required.

> Freebuff Sites / Cloudflare Workers cannot host this app: it is a long-running Node/Express process with
> database connections. Use a Node host (Render, Railway, Fly.io, Hetzner/DigitalOcean VPS, etc.).

---

## 1. Create the database

1. Create a free project at Supabase (or Neon / Railway Postgres).
2. Copy the **connection string** (Supabase: Project Settings → Database → Connection string → *Session
   pooler*, port 5432). It must look like:
   `postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres`
3. Nothing else to do — the server runs every migration in `server/db/migrations/` and seeds the first
   admin, default prizes, the device row and demo data on first boot.

## 2. Prepare the environment

Create the environment variables on the host (`NODE_ENV=production`):

```env
NODE_ENV=production
PORT=4000                     # most hosts inject this; keep whatever they give
DATABASE_URL=postgresql://...   # from step 1
JWT_SECRET=<64+ random chars>   # openssl rand -hex 32
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<strong password>   # only used when the admin table is empty
DEVICE_TOKEN=<long random string>  # must match the firmware
DEVICE_ID=FOODFEST_ESP32
CORS_ORIGINS=https://your-domain.example
```

- `JWT_SECRET` and `DEVICE_TOKEN` are secrets: never commit them, never put them in the frontend.
- `CORS_ORIGINS` must list the exact public URL(s) of the site. Requests with no Origin (ESP32, curl) are
  always allowed.
- Do **not** set `PGLITE_PATH` in production; `DATABASE_URL` takes over. Embedded PGlite is for local dev
  only (single process, no backup story).

## 3. Build and start

On the host (or in its build step):

```bash
npm ci
npm run build          # server -> server/dist, frontend -> web/dist
npm --workspace server run start
```

- Start command must run from the `server` workspace directory (the API serves `../web/dist`). Use
  `npm --workspace server run start` from the repo root, or `cd server && node dist/index.js`.
- The build step must run **before** start so `web/dist` exists.
- Health check URL: `GET /api/health` → `{ "ok": true, "database": "postgres" }`.

## 4. Domain, HTTPS and CORS

1. Point your domain at the host and enable HTTPS (most hosts do this automatically).
2. Set `CORS_ORIGINS=https://your-domain.example` and redeploy/restart.
3. HTTPS is required for browser text-to-speech, and strongly recommended for the ESP32.

## 5. ESP32 pointing at the live server

In `firmware/foodfest_spin/foodfest_spin.ino`:

```cpp
const char *WIFI_SSID     = "...";
const char *WIFI_PASSWORD = "...";
const char *API_BASE      = "https://your-domain.example";
const bool  API_USE_HTTPS = true;
const char *DEVICE_TOKEN  = "...";   // same value as the host's DEVICE_TOKEN
```

Flash it, then check **Admin → Device connection** shows *Online* within a minute.

## 6. Go-live checks (5 minutes)

1. `GET https://your-domain.example/api/health` returns `ok: true` and `database: "postgres"`.
2. Open the site, register one participant → number `001`.
3. Admin → sign in with the seeded credentials → change the password (Admins API) and switch mode to
   `real` only when the event starts.
4. Register 2 more participants → group 1 completes, one is picked, popup appears.
5. Press the physical joystick → wheel spins on the site, prize is announced, stock drops exactly once.
6. Admin → Customers → delete a test registration (confirm popup) and **Delete all real customers**
   before the real event starts (numbering restarts at 001).
7. Admin → Prizes → check only the enabled prizes are on the wheel; rename them, add a prize, toggle
   **Better luck next time**, then press **Save prizes**.

## 7. Operations notes

- **Backups**: enable automatic backups on the Postgres provider. Supabase free tier keeps daily backups;
  take a manual dump before the event (`pg_dump "$DATABASE_URL" > backup.sql`).
- **Restart safety**: nothing is held in memory — pending spins, selections, stock and settings all live in
  Postgres, so a restart mid-event resumes exactly where it stopped.
- **Stock**: `prize_stock` never goes negative; the ledger (`prize_stock_transactions`) records every change.
  CSV exports: `GET /api/admin/reports/{customers|groups|spins|stock}?mode=real`.
- **Scaling**: one instance is enough (and safest) for one festival machine. If the host must run more
  than one instance, keep the ESP32 and the phones on the same instance; SSE clients are per-instance.
- **Logs**: the API logs boot, migrations and errors to stdout — use the host's log viewer.
- **Cost**: one small Node instance + a free Postgres tier is enough for the whole event.
