import { getDb } from '../db/index.js';
import { broadcast } from '../lib/bus.js';
import { numberLabel } from '../lib/serialize.js';
import { syncGroup } from './customers.js';

export const DEMO_CUSTOMERS: Array<{
  name: string;
  rollNo: string;
  course: 'Science' | 'Commerce' | 'Arts';
  classLevel: '+1' | '+2';
}> = [
  { name: 'Anjali', rollNo: 'S101', course: 'Science', classLevel: '+1' },
  { name: 'Rahul', rollNo: 'C102', course: 'Commerce', classLevel: '+2' },
  { name: 'Arjun', rollNo: 'A103', course: 'Arts', classLevel: '+1' },
  { name: 'Meera', rollNo: 'S104', course: 'Science', classLevel: '+2' },
  { name: 'Amal', rollNo: 'C105', course: 'Commerce', classLevel: '+1' },
  { name: 'Nikhil', rollNo: 'A106', course: 'Arts', classLevel: '+2' },
  { name: 'Divya', rollNo: 'S107', course: 'Science', classLevel: '+1' },
  { name: 'Faisal', rollNo: 'C108', course: 'Commerce', classLevel: '+2' },
  { name: 'Gopika', rollNo: 'A109', course: 'Arts', classLevel: '+1' },
];

const DEMO_STOCK_RESET = 100;

/** Seeds the isolated demo customers + groups (numbers restart at 001). */
export async function seedDemoCustomers(): Promise<number> {
  const db = await getDb();
  const existing = await db.query<{ count: string }>(
    `select count(*)::text as count from customers where mode = 'demo'`,
  );
  if (Number(existing[0]?.count ?? 0) > 0) return 0;

  await db.transaction(async (tx) => {
    await tx.query(
      `insert into counters (key, value) values ('customer_demo', 0)
       on conflict (key) do nothing`,
    );
    for (const sample of DEMO_CUSTOMERS) {
      const counter = await tx.query<{ value: string }>(
        `select value from counters where key = 'customer_demo' for update`,
      );
      const number = Number(counter[0]?.value ?? 0) + 1;
      await tx.query(`update counters set value = $1 where key = 'customer_demo'`, [number]);
      const groupNumber = Math.ceil(number / 3);
      await tx.query(
        `insert into customers (mode, customer_number, group_number, name, roll_no, course, class_level)
         values ('demo', $1, $2, $3, $4, $5, $6)`,
        [number, groupNumber, sample.name, sample.rollNo, sample.course, sample.classLevel],
      );
      await syncGroup(tx, 'demo', groupNumber);
    }
  });

  return DEMO_CUSTOMERS.length;
}

export interface DemoResetResult {
  deletedSpins: number;
  seededCustomers: number;
  groups: number;
  stockReset: number;
}

/**
 * Wipes every demo spin/selection/customer and rebuilds sample data.
 * Real customers, real spin history and real prize stock are never touched.
 */
export async function resetDemo(): Promise<DemoResetResult> {
  const db = await getDb();

  const result = await db.transaction<DemoResetResult>(async (tx) => {
    const deleted = await tx.query<{ count: string }>(
      `select count(*)::text as count from spins where mode = 'demo'`,
    );
    await tx.query(`delete from spins where mode = 'demo'`);
    await tx.query(`delete from group_selections where mode = 'demo'`);
    await tx.query(`delete from customer_groups where mode = 'demo'`);
    await tx.query(`delete from customers where mode = 'demo'`);
    await tx.query(`update counters set value = 0 where key = 'customer_demo'`);

    const stockReset = await tx.query<{ count: string }>(
      `update prize_stock set stock = case when $1::int = 0 then 0 else $1::int end, updated_at = now()
        where mode = 'demo' and prize_id in (select id from prizes where is_unlimited = false)
      returning prize_id`,
      [DEMO_STOCK_RESET],
    );

    return {
      deletedSpins: Number(deleted[0]?.count ?? 0),
      seededCustomers: 0,
      groups: 0,
      stockReset: stockReset.length,
    };
  });

  const seeded = await seedDemoCustomers();
  const db2 = await getDb();
  const groups = await db2.query<{ count: string }>(
    `select count(*)::text as count from customer_groups where mode = 'demo'`,
  );

  broadcast({ type: 'data:changed', payload: { entity: 'demo' } });

  return {
    ...result,
    seededCustomers: seeded,
    groups: Number(groups[0]?.count ?? 0),
  };
}

/** Loads the demo groups ready for a demo spin. */
export async function demoGroupsReady() {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>(
    `select g.group_number, gs.customer_number, c.name
       from customer_groups g
       join group_selections gs on gs.group_id = g.id
       join customers c on c.id = gs.customer_id
      where g.mode = 'demo'
      order by g.group_number`,
  );
  return rows.map((row) => ({
    groupNumber: Number(row.group_number),
    customerNumber: Number(row.customer_number),
    customerNumberLabel: numberLabel(row.customer_number),
    customerName: row.name as string,
  }));
}
