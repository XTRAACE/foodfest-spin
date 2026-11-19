import { getDb, type Queryable } from '../db/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { weightedIndex } from '../lib/random.js';
import { asIso, toPrize, type Mode, type PrizeDTO } from '../lib/serialize.js';
import { getSettings, type SettingsDTO } from './settings.js';

export interface WheelSection {
  prizeId: string;
  name: string;
  imageUrl: string | null;
  color: string;
  weight: number;
  startAngle: number;
  endAngle: number;
  centerAngle: number;
  eligible: boolean;
  stock: number;
  isUnlimited: boolean;
}

export interface Wheel {
  sections: WheelSection[];
  totalWeight: number;
}

const ENABLED_PRIZES_SQL = `
  select p.*,
         coalesce(rs.stock, 0) as real_stock,
         coalesce(ds.stock, 0) as demo_stock,
         (select count(*) from spins sp
           where sp.prize_id = p.id and sp.mode = $1 and sp.status in ('pending', 'spinning')) as pending
    from prizes p
    left join prize_stock rs on rs.prize_id = p.id and rs.mode = 'real'
    left join prize_stock ds on ds.prize_id = p.id and ds.mode = 'demo'
   where p.is_enabled = true
   order by p.sort_order asc, p.created_at asc`;

export async function listPrizes(q?: Queryable): Promise<PrizeDTO[]> {
  const db = q ?? (await getDb());
  const rows = await db.query<Record<string, any>>(
    `select p.*,
            coalesce(rs.stock, 0) as real_stock,
            coalesce(ds.stock, 0) as demo_stock
       from prizes p
       left join prize_stock rs on rs.prize_id = p.id and rs.mode = 'real'
       left join prize_stock ds on ds.prize_id = p.id and ds.mode = 'demo'
      order by p.sort_order asc, p.created_at asc`,
  );
  return rows.map(toPrize);
}

// ---------------------------------------------------------------------------
// Prize tabs (categories) — "Mach", "Snack", … editable in the admin panel
// ---------------------------------------------------------------------------
export interface PrizeCategoryDTO {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string | null;
}

function toCategory(row: Record<string, any>): PrizeCategoryDTO {
  return {
    id: row.id as string,
    name: row.name as string,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: asIso(row.created_at),
  };
}

export async function listCategories(q?: Queryable): Promise<PrizeCategoryDTO[]> {
  const db = q ?? (await getDb());
  const rows = await db.query<Record<string, any>>(
    'select * from prize_categories order by sort_order asc, created_at asc',
  );
  return rows.map(toCategory);
}

export async function createCategory(name: string): Promise<PrizeCategoryDTO> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `insert into prize_categories (name, sort_order)
     values ($1, coalesce((select max(sort_order) + 1 from prize_categories), 0))
     returning *`,
    [name],
  );
  return toCategory(rows[0]!);
}

export async function updateCategory(
  id: string,
  patch: { name?: string; sortOrder?: number },
): Promise<PrizeCategoryDTO> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.sortOrder !== undefined) assign('sort_order', patch.sortOrder);

  if (sets.length === 0) {
    const rows = await db.query<Record<string, any>>('select * from prize_categories where id = $1', [id]);
    if (!rows[0]) throw notFound('CATEGORY_NOT_FOUND', 'Prize tab not found.');
    return toCategory(rows[0]);
  }

  values.push(id);
  const rows = await db.query<Record<string, any>>(
    `update prize_categories set ${sets.join(', ')} where id = $${values.length} returning *`,
    values,
  );
  if (!rows[0]) throw notFound('CATEGORY_NOT_FOUND', 'Prize tab not found.');
  return toCategory(rows[0]);
}

function stockFor(row: Record<string, any>, mode: Mode): number {
  return Number(row[mode === 'real' ? 'real_stock' : 'demo_stock'] ?? 0);
}

/**
 * Prizes that may actually be awarded: enabled, positive weight and stock
 * left after reserving prizes already promised to pending spins.
 */
export async function getEligiblePrizes(q: Queryable, mode: Mode): Promise<PrizeDTO[]> {
  const rows = await q.query<Record<string, any>>(ENABLED_PRIZES_SQL, [mode]);
  return rows
    .map((row) => ({ ...toPrize(row), pending: Number(row.pending ?? 0) }))
    .filter((prize) => {
      if (!prize.isEnabled || prize.weight <= 0) return false;
      if (prize.isUnlimited) return true;
      const stock = mode === 'real' ? prize.realStock : prize.demoStock;
      return stock - prize.pending > 0;
    });
}

/**
 * Equal visual sections (0° = top, clockwise). Probability is driven by weight,
 * not by the visual size, and both prices come from the same backend snapshot.
 */
export async function buildWheel(q: Queryable, mode: Mode): Promise<Wheel> {
  const rows = await q.query<Record<string, any>>(ENABLED_PRIZES_SQL, [mode]);
  const count = rows.length;
  if (count === 0) return { sections: [], totalWeight: 0 };

  const sections = rows.map((row, index) => {
    const prize = toPrize(row);
    const step = 360 / count;
    const startAngle = index * step;
    return {
      prizeId: prize.id,
      name: prize.name,
      imageUrl: prize.imageUrl,
      color: prize.color,
      weight: prize.weight,
      startAngle,
      endAngle: startAngle + step,
      centerAngle: startAngle + step / 2,
      eligible: prize.isUnlimited
        ? true
        : stockFor(row, mode) - Number(row.pending ?? 0) > 0,
      stock: stockFor(row, mode),
      isUnlimited: prize.isUnlimited,
    } satisfies WheelSection;
  });

  return {
    sections,
    totalWeight: sections.reduce((sum, section) => sum + section.weight, 0),
  };
}

export interface PrizePick {
  prize: PrizeDTO;
  section: WheelSection;
  totalWeight: number;
  probability: number;
  wheelAngle: number;
  servoAngle: number;
}

/** Maps a wheel angle (0–360) onto the calibrated 180° servo range. */
export function mapServoAngle(settings: SettingsDTO, wheelAngle: number): number {
  const min = settings.servoMinAngle;
  const max = settings.servoMaxAngle;
  const fraction = ((wheelAngle % 360) + 360) % 360 / 360;
  return Math.round(min + fraction * (max - min));
}

/**
 * Weighted random prize selection with a CSPRNG. Runs inside the caller's
 * transaction so the chosen prize is persisted before any animation starts.
 */
export async function pickPrize(
  q: Queryable,
  mode: Mode,
  settings: SettingsDTO,
): Promise<PrizePick> {
  const eligible = await getEligiblePrizes(q, mode);
  const wheel = await buildWheel(q, mode);

  const candidateSections = eligible
    .map((prize) => wheel.sections.find((section) => section.prizeId === prize.id))
    .filter((section): section is WheelSection => Boolean(section));

  if (candidateSections.length === 0) {
    throw conflict(
      'NO_PRIZES_AVAILABLE',
      'No prize can be awarded: every prize is disabled or out of stock. Enable a prize or refill stock.',
    );
  }

  const totalWeight = candidateSections.reduce((sum, section) => sum + section.weight, 0);
  const index = weightedIndex(candidateSections.map((section) => section.weight));
  const section = candidateSections[index]!;
  const prize = eligible.find((item) => item.id === section.prizeId)!;

  return {
    prize,
    section,
    totalWeight,
    probability: totalWeight > 0 ? Number((section.weight / totalWeight).toFixed(4)) : 0,
    wheelAngle: Number(section.centerAngle.toFixed(2)),
    servoAngle: prize.servoAngle ?? mapServoAngle(settings, section.centerAngle),
  };
}

export interface PrizeInput {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  color?: string;
  weight?: number;
  isEnabled?: boolean;
  isUnlimited?: boolean;
  isConsolation?: boolean;
  servoAngle?: number | null;
  categoryId?: string | null;
  sortOrder?: number;
  realStock?: number;
  demoStock?: number;
}

export async function createPrize(input: PrizeInput): Promise<PrizeDTO> {
  const db = await getDb();
  const created = await db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, any>>(
      `insert into prizes (name, description, image_url, color, weight, is_enabled, is_unlimited, is_consolation, servo_angle, category_id, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [
        input.name,
        input.description ?? null,
        input.imageUrl ?? null,
        input.color ?? '#f97316',
        input.weight ?? 1,
        input.isEnabled ?? true,
        input.isUnlimited ?? false,
        input.isConsolation ?? false,
        input.servoAngle ?? null,
        input.categoryId ?? null,
        input.sortOrder ?? 0,
      ],
    );
    const prize = rows[0]!;
    for (const mode of ['real', 'demo'] as Mode[]) {
      await tx.query(
        `insert into prize_stock (prize_id, mode, stock) values ($1, $2, $3)
         on conflict (prize_id, mode) do update set stock = excluded.stock, updated_at = now()`,
        [prize.id, mode, mode === 'real' ? input.realStock ?? 0 : input.demoStock ?? 100],
      );
    }
    return prize;
  });

  return toPrize({ ...created, real_stock: input.realStock ?? 0, demo_stock: input.demoStock ?? 100 });
}

export async function updatePrize(id: string, patch: Partial<PrizeInput>): Promise<PrizeDTO> {
  const db = await getDb();
  const existing = await db.query<Record<string, any>>('select * from prizes where id = $1', [id]);
  if (!existing[0]) throw notFound('PRIZE_NOT_FOUND', 'Prize not found.');

  const sets: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.description !== undefined) assign('description', patch.description);
  if (patch.imageUrl !== undefined) assign('image_url', patch.imageUrl);
  if (patch.color !== undefined) assign('color', patch.color);
  if (patch.weight !== undefined) assign('weight', patch.weight);
  if (patch.isEnabled !== undefined) assign('is_enabled', patch.isEnabled);
  if (patch.isUnlimited !== undefined) assign('is_unlimited', patch.isUnlimited);
  if (patch.isConsolation !== undefined) assign('is_consolation', patch.isConsolation);
  if (patch.servoAngle !== undefined) assign('servo_angle', patch.servoAngle);
  if (patch.categoryId !== undefined) assign('category_id', patch.categoryId);
  if (patch.sortOrder !== undefined) assign('sort_order', patch.sortOrder);

  if (sets.length > 0) {
    sets.push('updated_at = now()');
    values.push(id);
    await db.query(`update prizes set ${sets.join(', ')} where id = $${values.length}`, values);
  }

  const stockUpdates: Array<[Mode, number | undefined]> = [
    ['real', patch.realStock],
    ['demo', patch.demoStock],
  ];
  for (const [mode, stock] of stockUpdates) {
    if (stock === undefined) continue;
    await db.query(
      `insert into prize_stock (prize_id, mode, stock) values ($1, $2, $3)
       on conflict (prize_id, mode) do update set stock = excluded.stock, updated_at = now()`,
      [id, mode, stock],
    );
  }

  const rows = await db.query<Record<string, any>>(
    `select p.*, coalesce(rs.stock,0) as real_stock, coalesce(ds.stock,0) as demo_stock
       from prizes p
       left join prize_stock rs on rs.prize_id = p.id and rs.mode = 'real'
       left join prize_stock ds on ds.prize_id = p.id and ds.mode = 'demo'
      where p.id = $1`,
    [id],
  );
  return toPrize(rows[0]!);
}

/** Refuses to delete a prize that already appears in spin history. */
export async function deletePrize(id: string): Promise<void> {
  const db = await getDb();
  const used = await db.query<{ count: string }>('select count(*)::text as count from spins where prize_id = $1', [id]);
  if (Number(used[0]?.count ?? 0) > 0) {
    throw conflict(
      'PRIZE_IN_USE',
      'This prize already appears in spin history. Turn it off instead of deleting it.',
    );
  }
  await db.query('delete from prizes where id = $1', [id]);
}

export interface PrizeStockSummary {
  id: string;
  name: string;
  isEnabled: boolean;
  isUnlimited: boolean;
  weight: number;
  probability: number;
  stock: number;
  pending: number;
  awarded: number;
  color: string;
}

export async function prizeStockSummary(mode: Mode): Promise<PrizeStockSummary[]> {
  const db = await getDb();
  const settings = await getSettings(db);
  const prizes = await listPrizes(db);
  const eligible = await getEligiblePrizes(db, mode);
  const totalWeight = eligible.reduce((sum, prize) => sum + prize.weight, 0);

  const awardedRows = await db.query<Record<string, any>>(
    `select prize_id, count(*)::text as count from spins
      where mode = $1 and status = 'completed' group by prize_id`,
    [mode],
  );
  const awarded = new Map(awardedRows.map((row) => [row.prize_id as string, Number(row.count)]));

  return prizes.map((prize) => {
    const eligiblePrize = eligible.find((item) => item.id === prize.id);
    return {
      id: prize.id,
      name: prize.name,
      isEnabled: prize.isEnabled,
      isUnlimited: prize.isUnlimited,
      weight: prize.weight,
      probability:
        eligiblePrize && totalWeight > 0
          ? Number((prize.weight / totalWeight).toFixed(4))
          : 0,
      stock: mode === 'real' ? prize.realStock : prize.demoStock,
      pending: prize.pending ?? 0,
      awarded: awarded.get(prize.id) ?? 0,
      color: prize.color,
    };
  });
}

export function toStockTransaction(row: Record<string, any>) {
  return {
    id: row.id as string,
    prizeId: row.prize_id as string,
    prizeName: row.prize_name ?? null,
    mode: row.mode as Mode,
    spinCode: row.spin_code ?? null,
    delta: Number(row.delta),
    stockBefore: Number(row.stock_before),
    stockAfter: Number(row.stock_after),
    createdAt: asIso(row.created_at),
  };
}
