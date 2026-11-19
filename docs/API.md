# API reference — Food Fest Lucky Spin

Base URL: `http://localhost:4000/api` (dev). All requests and responses are JSON.

- Admin endpoints need `Authorization: Bearer <jwt>` from `POST /auth/login`.
- Device endpoints need `x-device-token: <DEVICE_TOKEN>`.
- Errors always look like:

```json
{ "ok": false, "error": { "code": "NO_PRIZES_AVAILABLE", "message": "…", "details": null } }
```

| Status | Meaning |
|---|---|
| 400 | validation / bad request |
| 401 | missing or invalid credentials |
| 403 | role not allowed |
| 404 | entity not found |
| 409 | conflict (duplicate, closed registration, no prize, spin not active) |
| 500 | unexpected error |

---

## Public

### `GET /public/status`
```json
{
  "ok": true,
  "eventName": "Food Fest 2026",
  "eventStatus": "active",
  "mode": "real",
  "registrationOpen": true,
  "registeredCustomers": 6,
  "duplicateMobileRule": "reject",
  "courses": ["Science", "Commerce", "Arts"],
  "classes": ["+1", "+2"]
}
```

### `POST /public/register`
```json
{
  "name": "Anjali",
  "rollNo": "21CS045",
  "course": "Science",
  "classLevel": "+1"
}
```
`rollNo` is optional. `course` is one of `Science`, `Commerce`, `Arts` and `classLevel`
is one of `+1`, `+2`. `mobile` is no longer collected by the public form (the field is
still accepted for API compatibility).
`201`:
```json
{
  "ok": true,
  "customer": {
    "id": "uuid", "mode": "real", "number": 3, "numberLabel": "003",
    "groupNumber": 1, "name": "Anjali", "mobile": null,
    "rollNo": "21CS045", "course": "Science", "classLevel": "+1",
    "isActive": true, "createdAt": "2026-11-19T17:00:00.000Z"
  },
  "groupNumber": 1,
  "groupComplete": true,
  "selected": true,
  "selectedCustomerNumber": 3,
  "selectedCustomer": { "numberLabel": "003", "name": "Anjali" }
}
```
`selectedCustomer` is the randomly chosen member of the completed group — the site announces it in
a popup and the ESP32 shows the same customer as `ready`.
Errors: `409 REGISTRATION_CLOSED`, `409 EVENT_ENDED`, `409 DUPLICATE_CUSTOMER`
(`details.customerNumber` contains the existing number). With duplicate protection on, a
mobile number or the same roll number in the same class cannot register twice.

### `GET /public/participants`
```json
{
  "ok": true,
  "count": 6,
  "participants": [
    { "numberLabel": "001", "groupNumber": 1, "name": "Anjali",
      "rollNo": "21CS045", "course": "Science", "classLevel": "+1" }
  ]
}
```
Read-only participation list for the registration page's **Participation** button. It never
returns contact details (no mobile, no email).

### `GET /public/prizes`
Enabled prizes only (name, description, image, colour) — safe to show on the registration page.

### `GET /public/lucky/current`
State for the customer-facing wheel page (mobile site).
```json
{
  "ok": true, "eventName": "Food Fest 2026", "eventStatus": "active", "mode": "real",
  "readyCustomer": { "customerId": "uuid", "number": 4, "numberLabel": "004", "name": "Anjali", "groupNumber": 2 },
  "wheel": { "sections": [ /* colour, name, angles */ ], "totalWeight": 20 },
  "pendingSpin": null
}
```
When a spin is in progress (from the machine's joystick or another phone) `pendingSpin` carries the
timing so a phone can join mid-spin and land with the physical wheel:
```json
{
  "code": "SPIN_000004", "status": "pending", "customerNumber": 4,
  "customerNumberLabel": "004", "customerName": "Anjali",
  "prizeId": "uuid", "prizeName": "Free Juice", "wheelAngle": 202.5,
  "durationMs": 5550, "remainingMs": 3800
}
```
`durationMs` is the show length reported by the device that started the spin
(`animation_ms`); `remainingMs` is how much of it is left when the server answers.

### `POST /public/spin`
Starts the spin for the selected customer from their phone. The prize is chosen and stored by the
backend before this returns; the phone only animates to `wheelAngle`.
```json
{ "customer_number": 4, "spin_id": "phone-uuid" }
```
`spin_id` is the phone's idempotency key — a retry with the same value returns the same spin.
```json
{ "ok": true, "reused": false, "wheel": { "sections": [ /* … */ ] },
  "spin": { "code": "SPIN_000002", "status": "pending", "customerNumber": 4,
            "customerNumberLabel": "004", "customerName": "Anjali",
            "prizeId": "uuid", "prizeName": "Free Juice", "wheelAngle": 202.5 } }
```
Errors: `409 DEMO_MODE`, `409 EVENT_NOT_ACTIVE`, `409 NO_CUSTOMER_READY`,
`409 SPIN_ALREADY_PENDING`, `409 NO_PRIZES_AVAILABLE`. `customer_number` must match the customer
who is currently selected.

### `POST /public/spin/:code/complete`
Called by the phone after the wheel stops. Deducts stock exactly once and is idempotent — the ESP32
may complete the same spin too.
```json
{ "ok": true, "spin_id": "SPIN_000002", "status": "completed",
  "prize_name": "Free Juice", "stock_deducted": true }
```

---

## Auth

### `POST /auth/login`
```json
{ "email": "admin@foodfest.local", "password": "admin12345" }
```
→ `{ "ok": true, "token": "jwt", "admin": { "id", "email", "name", "role" } }`

### `GET /auth/me` → current admin (requires JWT).

---

## Admin

All routes below are prefixed with `/admin` and require a JWT.

### Dashboard
`GET /admin/stats?mode=real|demo`
Returns registrations, groups (total/complete/waiting/remaining), selections, spins (total/completed/
pending), prize stock summary with probabilities, device status and the 8 latest spins.

### Customers
- `GET /admin/customers?mode=real&search=anj&group=2` — search by number, name, mobile or roll no.
- `POST /admin/customers` `{ name, rollNo?, course?, classLevel?, mode? }` — sequential number still enforced.
- `PATCH /admin/customers/:id` `{ name?, rollNo?, course?, classLevel?, mobile?, isActive? }`
- `DELETE /admin/customers/:id` (role `admin`) — deletes one customer with their group selection and spin
  history; their group returns to `waiting` if it no longer has a selected member.
- `DELETE /admin/customers?mode=real|demo` (role `admin`) — deletes every customer of that mode with
  groups, selections and spins, and restarts numbering at `001`. The other mode is untouched.
  The admin panel asks for confirmation before either call.

### Groups
`GET /admin/groups?mode=real` — every group with its three members, status, selection and spin.

### Prizes
- `GET /admin/prizes?mode=real` → `{ prizes, categories, summary, eligibility }`
  `prizes[].isEnabled` / `prizes[].categoryId` drive the admin switches; `categories` are the admin tabs
  (`Mach`, `Snack`, …). `summary` contains `probability` per prize (weight / total eligible weight).
- `POST /admin/categories` `{ "name": "Snack" }` (role `admin`) — add a tab.
- `PATCH /admin/categories/:id` `{ "name": "Sweets" }` (role `admin`) — rename a tab.
- `POST /admin/prizes` (role `admin`)
  ```json
  {
    "name": "₹1 Sweet", "description": "…", "imageUrl": null, "color": "#f97316",
    "weight": 5, "isEnabled": true, "isUnlimited": false,
    "servoAngle": null, "categoryId": "uuid or null", "sortOrder": 1,
    "realStock": 100, "demoStock": 100
  }
  ```
  Only enabled prizes take part in the random draw (`is_enabled = true`); if every prize is enabled,
  every prize can be drawn. Tabs do not filter the wheel — they only group prizes in the admin panel.
- `PATCH /admin/prizes/:id` — any subset of the same fields.
- `DELETE /admin/prizes/:id` — `409 PRIZE_IN_USE` if the prize already appears in spin history.

### Lucky spin
#### `GET /admin/lucky/current`
```json
{
  "ok": true,
  "settings": { "mode": "real", "eventName": "…" },
  "wheel": {
    "sections": [
      { "prizeId": "uuid", "name": "₹1 Sweet", "color": "#f97316", "weight": 5,
        "startAngle": 0, "endAngle": 90, "centerAngle": 45,
        "eligible": true, "stock": 99, "isUnlimited": false }
    ],
    "totalWeight": 20
  },
  "readyCustomer": { "customerId": "uuid", "number": 3, "numberLabel": "003", "name": "Anjali", "groupNumber": 1 },
  "pendingSpin": null,
  "lastSpin": null
}
```

#### `POST /admin/spins`
```json
{ "mode": "real", "groupId": "uuid (demo only, optional)", "customerId": "uuid (optional)" }
```
`201` → `{ ok: true, spin: {...}, wheel: {...}, reused: false }`

The response already contains the final prize and angles; the frontend only animates.
A repeated request while a real spin is pending returns that same spin (`reused: true`) instead of
creating a second one.

Errors: `409 NO_CUSTOMER_READY`, `409 NO_PRIZES_AVAILABLE`, `409 EVENT_PAUSED`, `409 EVENT_ENDED`.

#### `POST /admin/spins/:code/complete`
Marks the spin completed and deducts stock once. Safe to call repeatedly (idempotent).
```json
{ "ok": true, "spin": { "code": "SPIN_000001", "status": "completed", "stockDeducted": true } }
```

#### `POST /admin/spins/:code/cancel`
Cancels a pending spin.

#### `GET /admin/spins?mode=real|demo|all&status=&limit=`
Spin history, newest first.

### Demo
- `GET /admin/demo/groups` — demo groups and their selected customers.
- `POST /admin/demo/reset` — deletes demo spins/groups/customers, refills demo stock to 100 per limited
  prize and re-seeds the 9 sample customers. Real data is untouched.

### Settings & admins
- `GET /admin/settings` → `{ settings, admins }`
- `PATCH /admin/settings` (role `admin`)
  ```json
  {
    "eventName": "Food Fest 2026", "eventStatus": "active", "mode": "real",
    "registrationOpen": true, "duplicateMobileRule": "reject",
    "deviceId": "FOODFEST_ESP32", "servoMinAngle": 10, "servoMaxAngle": 170
  }
  ```
- `GET /admin/admins`, `POST /admin/admins` `{ email, name, password, role }`,
  `PATCH /admin/admins/:id` `{ name?, role?, isActive?, password? }` — role `admin` required.

### Hardware
- `GET /admin/device` → connection state, devices, recent commands, current spin.
- `POST /admin/device/commands`
  ```json
  { "type": "oled", "payload": { "line1": "FOOD FEST", "line2": "TEST", "line3": "OK" } }
  ```
  Types: `oled`, `tm1637` (`{ "text": "0003" }`), `servo` (`{ "angle": 90 }`), `reset`.
- `GET /admin/device/commands` — recent command log.

### Reports
- `GET /admin/reports/customers|groups|spins|stock?mode=real|demo` → `text/csv` download.
- `GET /admin/stock?mode=real` — stock movement ledger (JSON).
- `GET /admin/audit` — last 200 audit entries.

### Realtime
`GET /api/events?token=<jwt>` — Server-Sent Events: `ready`, `spin:created`, `spin:completed`,
`spin:updated`, `device:heartbeat`, `settings:updated`, `data:changed`. EventSource cannot send headers,
so the JWT is passed as a query parameter (validated server-side).

---

## Device (ESP32)

Header on every request: `x-device-token: <DEVICE_TOKEN>`.

### `GET /device/current`
Ready, real mode:
```json
{
  "mode": "real", "status": "ready", "spin_id": null,
  "customer_number": 3, "customer_name": "Anjali", "customer_number_label": "003",
  "group_number": 1, "event_name": "Food Fest 2026", "device_id": "FOODFEST_ESP32",
  "server_time": "2026-11-19T17:00:00.000Z"
}
```
Pending spin (demo or real):
```json
{
  "mode": "demo", "status": "spin_pending", "spin_id": "DEMO_000001",
  "customer_number": 3, "customer_name": "Anjali", "customer_number_label": "003",
  "prize_name": "₹1 Sweet", "prize_id": "uuid",
  "target_angle": 90, "wheel_angle": 45, "event_name": "…", "server_time": "…"
}
```
Other statuses: `waiting`, `paused`, `no_prizes`.

`target_angle` is the **servo** angle (0–180, already calibrated); `wheel_angle` is the 0–360 wheel angle.

### `POST /device/spin/start`
```json
{ "spin_id": "ESP32-12345", "device_id": "FOODFEST_ESP32", "animation_ms": 5550 }
```
`spin_id` is the firmware's idempotency key — send the same value when retrying.
`animation_ms` is the firmware's own show duration; the site mirrors the spin with it
(`durationMs` / `remainingMs` on `GET /public/lucky/current`).
```json
{
  "ok": true, "spin_id": "SPIN_000001",
  "customer_number": 3, "customer_number_label": "003", "customer_name": "Anjali",
  "prize_name": "₹1 Sweet", "target_angle": 90, "wheel_angle": 45, "mode": "real",
  "reused": false
}
```
Errors: `409 NO_CUSTOMER_READY`, `409 NO_PRIZES_AVAILABLE`, `409 EVENT_PAUSED`.

### `POST /device/spin/complete`
```json
{
  "spin_id": "SPIN_000001", "device_id": "FOODFEST_ESP32",
  "prize_name": "₹1 Sweet", "target_angle": 90, "mode": "real"
}
```
```json
{ "ok": true, "spin_id": "SPIN_000001", "status": "completed",
  "prize_name": "₹1 Sweet", "stock_deducted": true, "completed_at": "…" }
```
Idempotent. A prize-name mismatch is recorded in the audit log.

### `POST /device/heartbeat`
```json
{ "device_id": "FOODFEST_ESP32", "firmware_version": "1.0.0" }
```
A device counts as online for 90 seconds after its last heartbeat.

### `GET /device/commands` / `POST /device/commands/:id/ack`
Returns pending admin test commands; ack each one after executing it.

---

## Typical sequences

**Real event**
1. Customer registers → `POST /public/register` → `003`.
2. Third registration completes group 1 → backend selected one member (`/admin/groups`).
3. ESP32 polls `GET /device/current` → `ready` + customer 003.
4. Customer presses joystick → `POST /device/spin/start` → prize + servo angle (already stored as `pending`).
5. OLED/TM1637 show the customer, arrow animates to `target_angle`, admin wheel animates to `wheel_angle`.
6. `POST /device/spin/complete` → stock −1 once, spin `completed`.

**Demo**
1. Settings → mode `demo` (9 sample customers already seeded).
2. Admin **Demo spin** → `POST /admin/spins` → wheel animates → complete.
3. **Reset demo** restores sample data, demo stock and clears demo history.
