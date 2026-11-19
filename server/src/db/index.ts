import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../env.js';
import { createPgDriver } from './pg.js';
import { createPgliteDriver } from './pglite.js';
import type { Db } from './driver.js';

export type { Db, Queryable } from './driver.js';

let instance: Db | null = null;

export async function getDb(): Promise<Db> {
  if (instance) return instance;

  if (env.databaseUrl) {
    instance = createPgDriver(env.databaseUrl);
    console.log('[db] connected to PostgreSQL via DATABASE_URL');
  } else {
    const dir = resolve(process.cwd(), env.pglitePath);
    mkdirSync(dir, { recursive: true });
    instance = await createPgliteDriver(dir);
    console.log(`[db] using embedded PostgreSQL (PGlite) at ${dir}`);
    console.log('[db] set DATABASE_URL to use Supabase / hosted PostgreSQL');
  }
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
