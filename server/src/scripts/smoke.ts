/**
 * End-to-end API verification against a running server.
 *
 *   API_URL=http://localhost:4100 ADMIN_PASSWORD=smoke-pass123 \
 *   DEVICE_TOKEN=smoke-device-token npx tsx src/scripts/smoke.ts
 *
 * The script registers real customers, spins, checks idempotency, stock
 * deduction, disabled/out-of-stock prizes, the device API and demo isolation.
 * Use a throwaway database (PGLITE_PATH=./.data/smoke) — it writes data.
 */
const BASE = process.env.API_URL ?? 'http://localhost:4100';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@foodfest.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin12345';
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? 'dev-device-token-change-me';
const DEVICE_ID = process.env.DEVICE_ID ?? 'FOODFEST_ESP32';

let token = '';
let failures = 0;
let checks = 0;

function assert(condition: unknown, label: string, extra?: unknown): void {
  checks += 1;
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

const uniqueMobile = (index: number) => `93${String(Date.now()).slice(-6)}${String(index).padStart(2, '0')}`;

async function stockTotal(mode: 'real' | 'demo'): Promise<number> {
  const res = await api('GET', `/api/admin/prizes?mode=${mode}&eligibility=${mode}`);
  return (res.data.prizes ?? [])
    .filter((prize: any) => !prize.isUnlimited)
    .reduce((sum: number, prize: any) => sum + (mode === 'real' ? prize.realStock : prize.demoStock), 0);
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  const health = await api('GET', '/api/health');
  assert(health.status === 200 && health.data.ok, 'health endpoint responds');

  const noAuth = await api('GET', '/api/admin/stats?mode=real');
  assert(noAuth.status === 401, 'admin API rejects requests without a token', noAuth.data);

  const login = await api('POST', '/api/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  assert(login.status === 200 && Boolean(login.data.token), 'admin login returns a JWT', login.data);
  token = login.data.token;

  const badLogin = await api('POST', '/api/auth/login', {
    email: ADMIN_EMAIL,
    password: 'wrong-password',
  });
  assert(badLogin.status === 401, 'wrong password is rejected');

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  const settings = await api('PATCH', '/api/admin/settings', {
    mode: 'real',
    eventStatus: 'active',
    registrationOpen: true,
    duplicateMobileRule: 'reject',
    servoMinAngle: 10,
    servoMaxAngle: 170,
  });
  assert(settings.status === 200 && settings.data.settings.mode === 'real', 'settings switch to REAL mode');

  const resetDemo = await api('POST', '/api/admin/demo/reset');
  assert(resetDemo.status === 200, 'demo reset works', resetDemo.data);

  // -------------------------------------------------------------------------
  // Registration + grouping
  // -------------------------------------------------------------------------
  const rollNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => `SMOKE-${index}`);
  const numbers: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    const res = await api('POST', '/api/public/register', {
      name: `Smoke Customer ${index + 1}`,
      rollNo: rollNumbers[index],
      course: index % 2 === 0 ? 'Science' : 'Commerce',
      classLevel: index % 3 === 0 ? '+1' : '+2',
    });
    assert(res.status === 201, `customer ${index + 1} registers`, res.data);
    numbers.push(res.data.customer?.number);
    if (index === 2) {
      assert(res.data.groupComplete === true, 'group 1 becomes complete after the third registration');
      assert(typeof res.data.selectedCustomerNumber === 'number', 'group 1 selects exactly one customer');
      assert(
        res.data.selectedCustomer && typeof res.data.selectedCustomer.name === 'string',
        'group completion returns the selected customer name for the popup',
        res.data,
      );
    }
    if (index === 5) {
      assert(res.data.groupComplete === true, 'group 2 becomes complete after the sixth registration');
    }
    if (index === 6 || index === 7) {
      assert(res.data.groupComplete === false, `group 3 stays waiting after customer ${index + 1}`);
    }
    if (index === 6) {
      const partial = await api('GET', '/api/admin/groups?mode=real');
      const third = (partial.data.groups ?? []).find((group: any) => group.groupNumber === 3);
      assert(third?.status === 'waiting', 'group 3 remains waiting while incomplete');
    }
  }
  assert(
    numbers.join(',') === '1,2,3,4,5,6,7,8,9',
    'sequential customer numbers 001..009',
    numbers,
  );

  const duplicate = await api('POST', '/api/public/register', {
    name: 'Duplicate Participant',
    rollNo: rollNumbers[0],
    course: 'Science',
    classLevel: '+1',
  });
  assert(
    duplicate.status === 409 && duplicate.data.error.code === 'DUPLICATE_CUSTOMER',
    'duplicate roll number in the same class is rejected',
    duplicate.data,
  );

  const participants = await api('GET', '/api/public/participants');
  assert(
    participants.status === 200 &&
      Array.isArray(participants.data.participants) &&
      participants.data.participants.some((row: any) => row.rollNo === rollNumbers[0] && row.course === 'Science'),
    'public participation list exposes number, roll no, course and class',
    participants.data,
  );

  const groups = await api('GET', '/api/admin/groups?mode=real');
  const groupList = groups.data.groups ?? [];
  const complete = groupList.filter((group: any) => group.status === 'complete');
  assert(complete.length === 3, 'three groups are complete after nine registrations', complete.length);
  assert(
    complete.every((group: any) => group.selection && group.members.length === 3),
    'each complete group has three members and one selection',
  );
  assert(
    new Set(complete.map((group: any) => group.selection.customerId)).size === complete.length,
    'selections are unique across groups',
  );
  assert(
    groupList.find((group: any) => group.groupNumber === 3)?.status === 'complete',
    'group 3 completes once its third customer registers',
  );

  // A fourth group gives the site its own spin to test without using up the
  // selections the admin and device checks below rely on.
  for (let index = 10; index <= 12; index += 1) {
    const res = await api('POST', '/api/public/register', {
      name: `Smoke Customer ${index}`,
      rollNo: `SMOKE-${index}`,
      course: 'Arts',
      classLevel: '+2',
    });
    assert(res.status === 201, `customer ${index} registers`, res.data);
  }

  // -------------------------------------------------------------------------
  // Public site spin (phone wheel)
  // -------------------------------------------------------------------------
  const publicState = await api('GET', '/api/public/lucky/current');
  assert(
    publicState.status === 200 &&
      Boolean(publicState.data.readyCustomer) &&
      (publicState.data.wheel?.sections ?? []).length > 0,
    'public wheel exposes the selected customer and the wheel',
    publicState.data,
  );
  const publicReady = publicState.data.readyCustomer;

  const wrongPublicCustomer = await api('POST', '/api/public/spin', {
    customer_number: 999,
    spin_id: `smoke-public-wrong-${Date.now()}`,
  });
  assert(
    wrongPublicCustomer.status === 409,
    'public spin rejects a customer who is not selected',
    wrongPublicCustomer.data,
  );

  const publicKey = `smoke-public-${Date.now()}`;
  const publicSpin = await api('POST', '/api/public/spin', {
    customer_number: publicReady.number,
    spin_id: publicKey,
  });
  assert(
    publicSpin.status === 200 && Boolean(publicSpin.data.spin?.code),
    'public spin is created for the selected customer',
    publicSpin.data,
  );
  assert(
    typeof publicSpin.data.spin?.wheelAngle === 'number' &&
      typeof publicSpin.data.spin?.prizeName === 'string',
    'public spin returns the stored prize and wheel angle',
    publicSpin.data.spin,
  );

  const publicReplay = await api('POST', '/api/public/spin', {
    customer_number: publicReady.number,
    spin_id: publicKey,
  });
  assert(
    publicReplay.data.spin?.code === publicSpin.data.spin.code,
    'public spin retry returns the same spin (no duplicate)',
    { first: publicSpin.data.spin?.code, second: publicReplay.data.spin?.code },
  );

  const publicComplete = await api('POST', `/api/public/spin/${publicSpin.data.spin.code}/complete`);
  assert(
    publicComplete.status === 200 && publicComplete.data.status === 'completed',
    'public spin completes and deducts stock exactly once',
    publicComplete.data,
  );

  // -------------------------------------------------------------------------
  // Real spin lifecycle
  // -------------------------------------------------------------------------
  // Unlimited prizes write a zero-delta ledger row, so disable them here to
  // make the "stock decreases by one" assertion deterministic.
  const stockPrizes = await api('GET', '/api/admin/prizes?mode=real');
  for (const prize of stockPrizes.data.prizes ?? []) {
    if (prize.isUnlimited && prize.isEnabled) {
      await api('PATCH', `/api/admin/prizes/${prize.id}`, { isEnabled: false });
    }
  }
  const stockBefore = await stockTotal('real');

  const spin1 = await api('POST', '/api/admin/spins', {});
  assert(spin1.status === 201, 'first real spin is created', spin1.data);
  const created = spin1.data.spin;
  assert(created.status === 'pending', 'spin is stored as pending before animation');
  assert(typeof created.prizeName === 'string' && created.prizeName.length > 0, 'prize is selected and stored');
  assert(created.wheelAngle >= 0 && created.wheelAngle <= 360, 'wheel angle is returned');
  assert(created.servoAngle >= 10 && created.servoAngle <= 170, 'servo angle respects calibration');

  const stored = await api('GET', '/api/admin/spins?mode=real&limit=10');
  const storedSpin = (stored.data.spins ?? []).find((spin: any) => spin.code === created.code);
  assert(Boolean(storedSpin) && storedSpin.status === 'pending', 'stored spin is visible in history before completion');

  const pendingAgain = await api('POST', '/api/admin/spins', {});
  assert(
    pendingAgain.data.spin?.code === created.code,
    'a second request resumes the same pending spin instead of creating another',
  );

  const completed = await api('POST', `/api/admin/spins/${created.code}/complete`);
  assert(completed.status === 200 && completed.data.spin.status === 'completed', 'spin completes');
  assert(completed.data.spin.stockDeducted === true, 'stock is deducted on completion');

  const stockAfter = await stockTotal('real');
  assert(stockAfter === stockBefore - 1, 'real stock decreased by exactly one', { stockBefore, stockAfter });

  const repeat = await api('POST', `/api/admin/spins/${created.code}/complete`);
  assert(repeat.status === 200, 'repeated completion is idempotent');
  const stockAfterRepeat = await stockTotal('real');
  assert(stockAfterRepeat === stockAfter, 'repeat completion does not deduct stock twice');

  // -------------------------------------------------------------------------
  // Disabled / out-of-stock prizes
  // -------------------------------------------------------------------------
  const prizesRes = await api('GET', '/api/admin/prizes?mode=real');
  const prizes = prizesRes.data.prizes ?? [];
  const betterLuck = prizes.find((prize: any) => prize.name === 'Better Luck');
  const others = prizes.filter((prize: any) => prize.id !== betterLuck?.id);

  for (const prize of others) {
    await api('PATCH', `/api/admin/prizes/${prize.id}`, { isEnabled: false });
  }
  await api('PATCH', `/api/admin/prizes/${betterLuck.id}`, { isEnabled: true, isUnlimited: true, weight: 7 });

  const forcedSpin = await api('POST', '/api/admin/spins', {});
  assert(
    forcedSpin.status === 201 && forcedSpin.data.spin.prizeName === 'Better Luck',
    'disabled prizes are never selected',
    forcedSpin.data,
  );
  await api('POST', `/api/admin/spins/${forcedSpin.data.spin.code}/complete`);

  // Out of stock: only one prize enabled, with zero stock.
  await api('PATCH', `/api/admin/prizes/${betterLuck.id}`, { isEnabled: false });
  const limited = prizes.find((prize: any) => !prize.isUnlimited && prize.id !== betterLuck?.id);
  await api('PATCH', `/api/admin/prizes/${limited.id}`, { isEnabled: true, isUnlimited: false, realStock: 0 });
  const blocked = await api('POST', '/api/admin/spins', {});
  assert(
    blocked.status === 409 && blocked.data.error.code === 'NO_PRIZES_AVAILABLE',
    'out-of-stock / disabled prizes block the spin with a clear error',
    blocked.data,
  );

  // Restore a healthy configuration.
  for (const prize of prizes) {
    await api('PATCH', `/api/admin/prizes/${prize.id}`, {
      isEnabled: prize.name !== 'Mach',
      isUnlimited: prize.isUnlimited,
      realStock: prize.isUnlimited ? prize.realStock : Math.max(prize.realStock, 50),
      demoStock: prize.isUnlimited ? prize.demoStock : Math.max(prize.demoStock, 50),
      weight: prize.weight,
    });
  }

  // -------------------------------------------------------------------------
  // Device API
  // -------------------------------------------------------------------------
  const noDeviceToken = await api('GET', '/api/device/current');
  assert(noDeviceToken.status === 401, 'device API rejects a missing token');

  const wrongToken = await api('GET', '/api/device/current', undefined, {
    'x-device-token': 'totally-wrong',
  });
  assert(wrongToken.status === 401, 'device API rejects an invalid token');

  const deviceHeaders = { 'x-device-token': DEVICE_TOKEN };

  const heartbeat = await api(
    'POST',
    '/api/device/heartbeat',
    { device_id: DEVICE_ID, firmware_version: 'smoke-1.0' },
    deviceHeaders,
  );
  assert(heartbeat.status === 200, 'device heartbeat is accepted', heartbeat.data);

  const current = await api('GET', '/api/device/current', undefined, deviceHeaders);
  assert(
    current.status === 200 && ['ready', 'spin_pending', 'waiting'].includes(current.data.status),
    'device current returns a valid status',
    current.data,
  );

  const idempotencyKey = `smoke-${Date.now()}`;
  const deviceStart = await api(
    'POST',
    '/api/device/spin/start',
    { device_id: DEVICE_ID, spin_id: idempotencyKey, animation_ms: 5550 },
    deviceHeaders,
  );
  assert(deviceStart.status === 200 && deviceStart.data.ok === true, 'joystick start creates a spin', deviceStart.data);
  assert(
    deviceStart.data.animation_ms === 5550,
    'device start stores the ESP32 show duration',
    deviceStart.data,
  );

  const synced = await api('GET', '/api/public/lucky/current');
  assert(
    synced.data.pendingSpin?.durationMs === 5550 &&
      typeof synced.data.pendingSpin?.remainingMs === 'number' &&
      synced.data.pendingSpin.remainingMs <= 5550,
    'site sees the machine-started spin with the ESP32 timing',
    synced.data.pendingSpin,
  );

  const deviceStartReplay = await api(
    'POST',
    '/api/device/spin/start',
    { device_id: DEVICE_ID, spin_id: idempotencyKey },
    deviceHeaders,
  );
  assert(
    deviceStartReplay.data.spin_id === deviceStart.data.spin_id,
    'replayed joystick request returns the same spin (no duplicate)',
    { first: deviceStart.data.spin_id, second: deviceStartReplay.data.spin_id },
  );

  const devicePending = await api('GET', '/api/device/current', undefined, deviceHeaders);
  assert(devicePending.data.status === 'spin_pending', 'device sees the pending spin with angle', devicePending.data);
  assert(typeof devicePending.data.target_angle === 'number', 'pending spin exposes a servo target angle');

  const deviceComplete = await api(
    'POST',
    '/api/device/spin/complete',
    {
      spin_id: deviceStart.data.spin_id,
      device_id: DEVICE_ID,
      prize_name: deviceStart.data.prize_name,
      target_angle: deviceStart.data.target_angle,
      mode: 'real',
    },
    deviceHeaders,
  );
  assert(deviceComplete.status === 200 && deviceComplete.data.status === 'completed', 'device completes the spin', deviceComplete.data);

  // -------------------------------------------------------------------------
  // Demo isolation
  // -------------------------------------------------------------------------
  const realStockBeforeDemo = await stockTotal('real');
  const demoStockBefore = await stockTotal('demo');

  const demoMode = await api('PATCH', '/api/admin/settings', { mode: 'demo' });
  assert(demoMode.status === 200 && demoMode.data.settings.mode === 'demo', 'settings switch to DEMO mode');

  const demoSpin = await api('POST', '/api/admin/spins', {});
  assert(demoSpin.status === 201 && demoSpin.data.spin.mode === 'demo', 'demo spin is created', demoSpin.data);
  const demoPrizes = await api('GET', '/api/admin/prizes?mode=demo');
  const demoPrize = (demoPrizes.data.prizes ?? []).find(
    (prize: any) => prize.name === demoSpin.data.spin.prizeName,
  );
  await api('POST', `/api/admin/spins/${demoSpin.data.spin.code}/complete`);

  const realStockAfterDemo = await stockTotal('real');
  const demoStockAfter = await stockTotal('demo');
  assert(realStockAfterDemo === realStockBeforeDemo, 'demo spin never touches real stock', {
    realStockBeforeDemo,
    realStockAfterDemo,
  });
  if (demoPrize?.isUnlimited) {
    assert(demoStockAfter === demoStockBefore, 'unlimited demo prize leaves limited demo stock unchanged');
  } else {
    assert(demoStockAfter === demoStockBefore - 1, 'demo spin deducts only demo stock', {
      demoStockBefore,
      demoStockAfter,
    });
  }

  const demoReset = await api('POST', '/api/admin/demo/reset');
  assert(demoReset.status === 200 && demoReset.data.groups >= 3, 'demo reset rebuilds sample groups', demoReset.data);

  const demoSpinsAfterReset = await api('GET', '/api/admin/spins?mode=demo&limit=100');
  assert((demoSpinsAfterReset.data.spins ?? []).length === 0, 'demo reset clears demo spin history');

  const realSpins = await api('GET', '/api/admin/spins?mode=real&limit=100');
  assert((realSpins.data.spins ?? []).length > 0, 'real spin history survives the demo reset');

  await api('PATCH', '/api/admin/settings', { mode: 'real' });

  // -------------------------------------------------------------------------
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Smoke test crashed', error);
  process.exit(1);
});
