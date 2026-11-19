import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Db } from './driver.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export async function runMigrations(db: Db): Promise<string[]> {
  await db.exec(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Set(
    (await db.query<{ name: string }>('select name from _migrations')).map((row) => row.name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(sql);
    await db.query('insert into _migrations (name) values ($1) on conflict do nothing', [file]);
    ran.push(file);
    console.log(`[db] applied migration ${file}`);
  }

  return ran;
}
