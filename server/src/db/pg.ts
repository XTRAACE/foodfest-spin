import pg from 'pg';
import type { Db, Queryable } from './driver.js';

/**
 * PostgreSQL driver used with Supabase (or any Postgres) through DATABASE_URL.
 */
export function createPgDriver(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? undefined : { rejectUnauthorized: false },
    max: 10,
  });

  return {
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await pool.query(sql, params as never[]);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({
          async query<R>(sql: string, params: unknown[] = []): Promise<R[]> {
            const res = await client.query(sql, params as never[]);
            return res.rows as R[];
          },
        });
        await client.query('commit');
        return result;
      } catch (error) {
        try {
          await client.query('rollback');
        } catch {
          /* connection already broken */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
