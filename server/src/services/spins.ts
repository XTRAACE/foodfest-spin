import { getDb, type Queryable } from '../db/index.js';
import { broadcast } from '../lib/bus.js';
import { conflict, notFound } from '../lib/errors.js';
import { securePick } from '../lib/random.js';
import { toSpin, type Mode, type SpinDTO } from '../lib/serialize.js';
import { logAudit } from './audit.js';
import { buildWheel, pickPrize, type Wheel } from './prizes.js';
import { getSettings } from './settings.js';

async function nextSpinCode(tx: Queryable, mode: Mode): Promise<string> {
  const key = `spin_${mode}`;
  await tx.query('insert into counters (key, value) values ($1, 0) on conflict (key) do nothing', [key]);
  const rows = await tx.query<{ value: string }>(
    'select value from counters where key = $1 for update',
    [key],
  );
  const next = Number(rows[0]?.value ?? 0) + 1;
  await tx.query('update counters set value = $2 where key = $1', [key, next]);
  const prefix = mode === 'demo' ? 'DEMO' : 'SPIN';
  return `${prefix}_${String(next).padStart(6, '0')}`;
}

export interface CreateSpinOptions {
  mode?: Mode;
  source: 'admin' | 'device' | 'site';
  deviceId?: string | null;
  groupId?: string | null;
  customerId?: string | null;
  idempotencyKey?: string | null;
  /** Show duration reported by the initiating device, for site sync. */
  animationMs?: number | null;
  actor?: string;
}

export interface CreateSpinResult {
  spin: SpinDTO;
  wheel: Wheel;
  reused: boolean;
}

interface SelectedCustomer {
  customer_id: string;
  customer_number: number;
  customer_name: string;
  group_id: string | null;
  group_number: number | null;
}

async function resolveReadySelection(tx: Queryable): Promise<SelectedCustomer | null> {
  const rows = await tx.query<SelectedCustomer>(
    `select gs.customer_id, gs.customer_number, c.name as customer_name,
            gs.group_id, gs.group_number
       from group_selections gs
       join customers c on c.id = gs.customer_id
      where gs.mode = 'real' and c.is_active = true
        and not exists (select 1 from spins s where s.customer_id = gs.customer_id and s.mode = 'real')
      order by gs.group_number asc
      limit 1`,
  );
  return rows[0] ?? null;
}

async function resolveDemoCustomer(
  tx: Queryable,
  groupId?: string | null,
  customerId?: string | null,
): Promise<SelectedCustomer | null> {
  if (customerId) {
    const rows = await tx.query<SelectedCustomer>(
      `select c.id as customer_id, c.customer_number, c.name as customer_name,
              gs.group_id, c.group_number
         from customers c
         left join group_selections gs on gs.customer_id = c.id
        where c.id = $1 and c.mode = 'demo' and c.is_active = true`,
      [customerId],
    );
    return rows[0] ?? null;
  }

  if (groupId) {
    const rows = await tx.query<SelectedCustomer>(
      `select gs.customer_id, gs.customer_number, c.name as customer_name,
              gs.group_id, gs.group_number
         from group_selections gs
         join customers c on c.id = gs.customer_id
        where gs.mode = 'demo' and gs.group_id = $1`,
      [groupId],
    );
    return rows[0] ?? null;
  }

  const rows = await tx.query<SelectedCustomer>(
    `select gs.customer_id, gs.customer_number, c.name as customer_name,
            gs.group_id, gs.group_number
       from group_selections gs
       join customers c on c.id = gs.customer_id
      where gs.mode = 'demo' and c.is_active = true
      order by gs.group_number asc`,
  );
  if (rows.length === 0) return null;
  return securePick(rows);
}

/**
 * Creates the spin and freezes the prize BEFORE any animation starts.
 * Real mode allows exactly one spin per selected customer (DB unique index).
 */
export async function createSpin(options: CreateSpinOptions): Promise<CreateSpinResult> {
  const db = await getDb();

  const result = await db.transaction<CreateSpinResult>(async (tx) => {
    const settings = await getSettings(tx);
    const mode: Mode = options.mode ?? settings.mode;

    if (settings.eventStatus === 'ended') {
      throw conflict('EVENT_ENDED', 'The event has ended. Spins are closed.');
    }
    if (settings.eventStatus === 'paused') {
      throw conflict('EVENT_PAUSED', 'The event is paused. Resume it from Settings to spin.');
    }

    // Idempotency: the same request key always returns the same spin.
    if (options.idempotencyKey) {
      const existing = await tx.query<Record<string, any>>(
        'select * from spins where idempotency_key = $1',
        [options.idempotencyKey],
      );
      if (existing[0]) {
        return { spin: toSpin(existing[0]), wheel: await buildWheel(tx, mode), reused: true };
      }
    }

    if (mode === 'real') {
      // A pending real spin is never duplicated – retries resume it.
      const pending = await tx.query<Record<string, any>>(
        `select * from spins where mode = 'real' and status in ('pending', 'spinning')
          order by requested_at asc limit 1`,
      );
      if (pending[0]) {
        return { spin: toSpin(pending[0]), wheel: await buildWheel(tx, 'real'), reused: true };
      }
    } else {
      // A new demo spin supersedes any stale pending demo spin.
      await tx.query(
        `update spins set status = 'cancelled' where mode = 'demo' and status = 'pending'`,
      );
    }

    const customer =
      mode === 'real'
        ? await resolveReadySelection(tx)
        : await resolveDemoCustomer(tx, options.groupId, options.customerId);

    if (!customer) {
      throw conflict(
        'NO_CUSTOMER_READY',
        mode === 'real'
          ? 'No selected customer is waiting to spin. A group needs all three registrations first.'
          : 'No demo customer is selected yet. Reset the demo data to regenerate sample groups.',
      );
    }

    const wheel = await buildWheel(tx, mode);
    if (wheel.sections.length === 0) {
      throw conflict('NO_PRIZES_AVAILABLE', 'No enabled prize is configured for the wheel.');
    }

    const pick = await pickPrize(tx, mode, settings);
    const code = await nextSpinCode(tx, mode);

    const inserted = await tx.query<Record<string, any>>(
      `insert into spins (
         spin_code, mode, status, customer_id, group_id, customer_number, customer_name,
         prize_id, prize_name, prize_weight, total_weight, probability,
         wheel_angle, servo_angle, source, device_id, idempotency_key, animation_ms
       ) values ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       returning *`,
      [
        code,
        mode,
        customer.customer_id,
        customer.group_id,
        customer.customer_number,
        customer.customer_name,
        pick.prize.id,
        pick.prize.name,
        pick.section.weight,
        pick.totalWeight,
        pick.probability,
        pick.wheelAngle,
        pick.servoAngle,
        options.source,
        options.deviceId ?? null,
        options.idempotencyKey ?? null,
        options.animationMs ?? null,
      ],
    );

    return { spin: toSpin(inserted[0]!), wheel, reused: false };
  });

  if (!result.reused) {
    broadcast({ type: 'spin:created', payload: result.spin });
  }
  return result;
}

export interface CompleteSpinOptions {
  spinCode: string;
  deviceId?: string | null;
  actor?: string;
  reportedPrizeName?: string | null;
}

/**
 * Marks the spin completed and deducts stock exactly once.
 * Idempotent: a repeated completion returns the stored result untouched.
 */
export async function completeSpin(options: CompleteSpinOptions): Promise<SpinDTO> {
  const db = await getDb();

  const completed = await db.transaction<SpinDTO>(async (tx) => {
    const rows = await tx.query<Record<string, any>>(
      'select * from spins where spin_code = $1 for update',
      [options.spinCode],
    );
    const spin = rows[0];
    if (!spin) throw notFound('SPIN_NOT_FOUND', 'Spin not found for this code.');

    if (spin.status === 'completed') return toSpin(spin);
    if (spin.status === 'cancelled' || spin.status === 'failed') {
      throw conflict('SPIN_NOT_ACTIVE', `Spin ${spin.spin_code} is ${spin.status} and cannot be completed.`);
    }

    if (
      options.reportedPrizeName &&
      String(options.reportedPrizeName).trim() !== String(spin.prize_name)
    ) {
      await logAudit(tx, {
        actor: options.actor ?? 'device',
        action: 'spin.prize_mismatch',
        entity: 'spin',
        entityId: spin.id,
        details: { reported: options.reportedPrizeName, stored: spin.prize_name },
      });
    }

    let stockDeducted = false;

    if (spin.prize_id) {
      const prizeRows = await tx.query<Record<string, any>>(
        'select * from prizes where id = $1',
        [spin.prize_id],
      );
      const prize = prizeRows[0];

      if (prize?.is_unlimited) {
        // Unlimited prize: write a zero-delta ledger row for traceability.
        await tx.query(
          `insert into prize_stock_transactions (prize_id, mode, spin_id, delta, stock_before, stock_after)
           values ($1, $2, $3, 0, 0, 0) on conflict (spin_id) do nothing`,
          [spin.prize_id, spin.mode, spin.id],
        );
        stockDeducted = true;
      } else if (prize) {
        const updated = await tx.query<{ stock: number }>(
          `update prize_stock set stock = stock - 1, updated_at = now()
            where prize_id = $1 and mode = $2 and stock > 0
            returning stock`,
          [spin.prize_id, spin.mode],
        );
        if (updated[0]) {
          const stockAfter = Number(updated[0].stock);
          await tx.query(
            `insert into prize_stock_transactions (prize_id, mode, spin_id, delta, stock_before, stock_after)
             values ($1, $2, $3, -1, $4, $5) on conflict (spin_id) do nothing`,
            [spin.prize_id, spin.mode, spin.id, stockAfter + 1, stockAfter],
          );
          stockDeducted = true;
        } else {
          // Stock vanished between selection and completion: never go negative.
          await logAudit(tx, {
            actor: options.actor ?? 'device',
            action: 'stock.deduction_skipped',
            entity: 'spin',
            entityId: spin.id,
            details: { reason: 'out_of_stock_at_completion', prize: spin.prize_name },
          });
        }
      }
    }

    const done = await tx.query<Record<string, any>>(
      `update spins
          set status = 'completed', completed_at = now(), stock_deducted = $2
        where id = $1
      returning *`,
      [spin.id, stockDeducted],
    );

    return toSpin(done[0]!);
  });

  broadcast({ type: 'spin:completed', payload: completed });
  return completed;
}

export async function cancelSpin(spinCode: string, actor: string): Promise<SpinDTO> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `update spins set status = 'cancelled'
      where spin_code = $1 and status in ('pending', 'spinning')
      returning *`,
    [spinCode],
  );
  if (!rows[0]) throw conflict('SPIN_NOT_CANCELLABLE', 'Only a pending spin can be cancelled.');
  await logAudit(db, { actor, action: 'spin.cancelled', entity: 'spin', entityId: rows[0].id });
  const dto = toSpin(rows[0]);
  broadcast({ type: 'spin:updated', payload: dto });
  return dto;
}

export async function listSpins(options: {
  mode?: Mode | 'all';
  status?: string;
  limit?: number;
}): Promise<SpinDTO[]> {
  const db = await getDb();
  const params: unknown[] = [];
  const where: string[] = [];

  if (options.mode && options.mode !== 'all') {
    params.push(options.mode);
    where.push(`mode = $${params.length}`);
  }
  if (options.status) {
    params.push(options.status);
    where.push(`status = $${params.length}`);
  }

  params.push(options.limit ?? 100);
  const rows = await db.query<Record<string, any>>(
    `select * from spins ${where.length ? `where ${where.join(' and ')}` : ''}
      order by requested_at desc limit $${params.length}`,
    params,
  );
  return rows.map(toSpin);
}

export async function getSpin(spinCode: string): Promise<SpinDTO> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>('select * from spins where spin_code = $1', [spinCode]);
  if (!rows[0]) throw notFound('SPIN_NOT_FOUND', 'Spin not found.');
  return toSpin(rows[0]);
}

/** What the Lucky Spin screen currently shows. */
export async function currentWheelState(): Promise<{
  settings: Awaited<ReturnType<typeof getSettings>>;
  wheel: Wheel;
  readyCustomer: { customerId: string; number: number; numberLabel: string; name: string; groupNumber: number | null } | null;
  pendingSpin: SpinDTO | null;
  lastSpin: SpinDTO | null;
}> {
  const db = await getDb();
  const settings = await getSettings(db);
  const wheel = await buildWheel(db, settings.mode);

  let readyCustomer = null;
  if (settings.mode === 'real') {
    const rows = await db.query<Record<string, any>>(
      `select gs.customer_id, gs.customer_number, gs.group_number, c.name
         from group_selections gs join customers c on c.id = gs.customer_id
        where gs.mode = 'real' and c.is_active = true
          and not exists (select 1 from spins s where s.customer_id = gs.customer_id and s.mode = 'real')
        order by gs.group_number asc limit 1`,
    );
    if (rows[0]) {
      readyCustomer = {
        customerId: rows[0].customer_id,
        number: Number(rows[0].customer_number),
        numberLabel: String(rows[0].customer_number).padStart(3, '0'),
        name: rows[0].name,
        groupNumber: Number(rows[0].group_number),
      };
    }
  }

  const pending = await db.query<Record<string, any>>(
    `select * from spins where mode = $1 and status in ('pending', 'spinning')
      order by requested_at desc limit 1`,
    [settings.mode],
  );
  const last = await db.query<Record<string, any>>(
    `select * from spins where mode = $1 order by requested_at desc limit 1`,
    [settings.mode],
  );

  return {
    settings,
    wheel,
    readyCustomer,
    pendingSpin: pending[0] ? toSpin(pending[0]) : null,
    lastSpin: last[0] ? toSpin(last[0]) : null,
  };
}
