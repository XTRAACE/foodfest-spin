import bcrypt from 'bcryptjs';
import { env } from '../env.js';
import { getDb, type Queryable } from '../db/index.js';
import { seedDemoCustomers } from './demo.js';
import { upsertDevice } from './devices.js';
import { getSettings } from './settings.js';

const DEFAULT_PRIZES = [
  {
    name: 'Mach',
    description: 'Grand prize (disabled by default)',
    color: '#dc2626',
    weight: 0,
    isEnabled: false,
    isUnlimited: false,
    isConsolation: false,
    sortOrder: 0,
    realStock: 0,
    demoStock: 0,
  },
  {
    name: '₹1 Sweet',
    description: 'One rupee sweet box',
    color: '#f97316',
    weight: 5,
    isEnabled: true,
    isUnlimited: false,
    isConsolation: false,
    sortOrder: 1,
    realStock: 100,
    demoStock: 100,
  },
  {
    name: '½ ₹ Sweet',
    description: 'Half rupee sweet',
    color: '#facc15',
    weight: 5,
    isEnabled: true,
    isUnlimited: false,
    isConsolation: false,
    sortOrder: 2,
    realStock: 100,
    demoStock: 100,
  },
  {
    name: 'Better Luck',
    description: 'Consolation - spin again next time',
    color: '#0ea5e9',
    weight: 10,
    isEnabled: true,
    isUnlimited: true,
    isConsolation: true,
    sortOrder: 3,
    realStock: 0,
    demoStock: 0,
  },
];

async function ensureAdmin(tx: Queryable): Promise<void> {
  const existing = await tx.query<{ count: string }>('select count(*)::text as count from admin_users');
  if (Number(existing[0]?.count ?? 0) > 0) return;

  const hash = await bcrypt.hash(env.adminPassword, 10);
  await tx.query(
    `insert into admin_users (email, name, password_hash, role)
     values ($1, $2, $3, 'admin') on conflict (email) do nothing`,
    [env.adminEmail.toLowerCase(), env.adminName, hash],
  );
  console.log(`[seed] created first admin: ${env.adminEmail}`);
  console.log('[seed] change the password after the first sign-in (Settings -> Admins)');
}

async function ensurePrizes(tx: Queryable): Promise<void> {
  const existing = await tx.query<{ count: string }>('select count(*)::text as count from prizes');
  if (Number(existing[0]?.count ?? 0) > 0) return;

  const categoryRows = await tx.query<Record<string, any>>(
    'select id, name from prize_categories order by sort_order asc, created_at asc',
  );
  const categoryFor = (name: string) => {
    const wanted = name.toLowerCase() === 'mach' ? 'mach' : 'snack';
    const match =
      categoryRows.find((row) => String(row.name).toLowerCase() === wanted) ?? categoryRows[0];
    return match ? (match.id as string) : null;
  };

  for (const prize of DEFAULT_PRIZES) {
    const rows = await tx.query<Record<string, any>>(
      `insert into prizes (name, description, color, weight, is_enabled, is_unlimited, is_consolation, sort_order, category_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        prize.name,
        prize.description,
        prize.color,
        prize.weight,
        prize.isEnabled,
        prize.isUnlimited,
        prize.isConsolation,
        prize.sortOrder,
        categoryFor(prize.name),
      ],
    );
    const prizeId = rows[0]!.id;
    await tx.query(
      `insert into prize_stock (prize_id, mode, stock) values ($1, 'real', $2), ($1, 'demo', $3)
       on conflict (prize_id, mode) do nothing`,
      [prizeId, prize.realStock, prize.demoStock],
    );
  }
  console.log('[seed] added default prize configuration');
}

/** Safe to call on every boot: only fills in what is missing. */
export async function bootstrap(): Promise<void> {
  const db = await getDb();
  await getSettings(db);

  await db.transaction(async (tx) => {
    await ensureAdmin(tx);
    await ensurePrizes(tx);
  });

  await upsertDevice({
    deviceId: env.deviceId,
    token: env.deviceToken,
    name: 'Food Fest Spin Machine',
  });

  const seeded = await seedDemoCustomers();
  if (seeded > 0) console.log(`[seed] created ${seeded} demo customers (3 demo groups)`);
}
