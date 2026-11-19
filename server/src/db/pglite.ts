import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from './driver.js';

/**
 * Embedded PostgreSQL used for local development when DATABASE_URL is empty.
 * It runs the very same SQL migrations as Supabase, so behaviour matches.
 */
export async function createPgliteDriver(dataDir: string): Promise<Db> {
  const lite = await PGlite.create(dataDir);

  const asQueryable = (runner: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await runner.query(sql, params);
      return (result.rows ?? []) as T[];
    },
  });

  const root = asQueryable(lite as never);

  return {
    kind: 'pglite',
    query: root.query,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return lite.transaction(async (tx) => fn(asQueryable(tx as never))) as Promise<T>;
    },
    async exec(sql: string): Promise<void> {
      await lite.exec(sql);
    },
    async close(): Promise<void> {
      await lite.close();
    },
  };
}
