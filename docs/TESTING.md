# Testing guide

## Automated checks

```bash
npm run typecheck                          # API + frontend TypeScript
npm --workspace server run verify:logic    # CSPRNG / weighted probability statistics
npm --workspace server run build           # API compiles to dist/
npm --workspace web run build              # production frontend build
```

### End-to-end API test (57 checks)

The smoke script exercises registration, grouping, selection, weighted selection, stock deduction,
idempotency, disabled/out-of-stock prizes, device auth and demo isolation. Run it against a **throwaway
server** so your event data stays clean:

```bash
# terminal A — fresh database on a separate port
cd server
PORT=4100 PGLITE_PATH=./.data/smoke ADMIN_PASSWORD=smoke-pass123 \
DEVICE_TOKEN=smoke-device-token npx tsx src/index.ts

# terminal B
cd server
API_URL=http://127.0.0.1:4100 ADMIN_PASSWORD=smoke-pass123 \
DEVICE_TOKEN=smoke-device-token npx tsx src/scripts/smoke.ts

# cleanup
rm -rf server/.data/smoke
```

Expected tail: `57/57 checks passed`.

### Logic checks

`verify:logic` runs 200 000 samples and asserts:

- weights 5 / 5 / 10 produce 25% / 25% / 50% (±1%)
- each of three group members is selected 33.33% of the time (±1%)
- a zero total weight throws instead of awarding a prize

---

## Manual checklist (the 20 required scenarios)

| # | Scenario | How to verify |
|---|---|---|
| 1 | Register six customers → two groups | Registration page ×6; **Groups** shows 2 complete groups |
| 2 | One selection per completed group | **Groups**: each card has exactly one gold "Selected" member |
| 3 | Equal 1/3 chance | `verify:logic` member-distribution check |
| 4 | Incomplete group cannot spin | Register 2 customers → **Groups** shows waiting; wheel says "no selected customer" |
| 5 | Disabled prizes never selected | Disable all but one prize, spin → that prize wins |
| 6 | Out-of-stock prizes never selected | Set a prize stock to 0 (and disable others) → spin blocked with a clear error |
| 7 | Weighted probability | Prize table shows 25%/25%/50% for 5/5/10; `verify:logic` |
| 8 | Prize stored before animation | After pressing spin, **History** lists the spin as `pending` with its prize |
| 9 | Wheel stops on the correct prize | Wheel rotation lands under the pointer on the awarded section |
| 10 | Arrow stops at calibrated angle | Compare **Hardware** log / OLED angle with the spin's `servoAngle` |
| 11 | OLED + TM1637 show the customer | OLED: number + name + "Ready to spin"; TM1637: `0003` |
| 12 | Joystick only starts eligible real spins | Press with no selection → "No customer ready" message, no spin |
| 13 | DEMO SPIN from dashboard | Settings → demo → **Demo spin** works repeatedly |
| 14 | Demo never affects real stock | Note real stock, run demo spins, real stock unchanged (**Prize management** → real tab) |
| 15 | Real spin deducts stock once | Stock −1 after completion; **History → Stock movements** has one row |
| 16 | Duplicate requests create no extra spins | Click spin twice / replay device request → same `spin_code` |
| 17 | Wi-Fi drop during a spin | Disable the AP mid-spin; device retries; spin stays `pending` |
| 18 | Reconnect recovery | Re-enable Wi-Fi: device re-syncs, `GET /device/current` returns the pending spin and completes it |
| 19 | Settings update the system | Change event name / mode / registration / servo range → reflected in UI and `/device/current` |
| 20 | Desktop and mobile | Resize to 375 px width; sidebar collapses, tables scroll, wheel scales |

---

## Hardware-only checks (cannot be automated here)

These require the physical machine and are **not** covered by the automated scripts:

- Servo sweep stays inside the calibrated range and never stalls against an end stop.
- Arrow actually points at the printed sector matching the prize (calibrate in Settings → Prize angle
  calibration).
- OLED text fits the 128×64 SH1106 panel without clipping.
- TM1637 shows the zero-padded 4-digit customer number.
- Joystick debounce feels right (one spin per press).
- Power stability: servo on its own 5 V supply with common ground.

---

## Recovery / failure drill

1. Start a real spin so a `pending` spin exists (`POST /admin/spins`).
2. Unplug the ESP32 or stop the API mid-spin.
3. Reload **Lucky spin** → "Resume pending SPIN_xxxxxx" appears (the prize is unchanged).
4. Resume: wheel re-animates to the stored angle; **Cancel** abandons it.
5. Starting a new spin is impossible until the pending one is completed or cancelled — this prevents a
   customer from spinning twice.
