import pg from 'pg'
import { env } from './env.js'

const { Pool } = pg

/** Request-path pool: connects as the non-owner role so RLS always applies. */
export const pool = new Pool({ connectionString: env.appDatabaseUrl, max: 8 })

/** Owner pool: background jobs only (they legitimately act across tenants). */
export const ownerPool = new Pool({ connectionString: env.databaseUrl, max: 4 })

/** Anything that can run a query: a pooled client (RLS-scoped) or a pool (service work). */
export type Db = pg.PoolClient | pg.Pool

/**
 * Runs `fn` in a transaction with `app.user_id` set, which is what every RLS policy
 * reads through current_user_id(). A null user means "anonymous visitor".
 */
export async function withUser<T>(
  userId: string | null,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('begin')
    await db.query('select set_config($1, $2, true)', ['app.user_id', userId ?? ''])
    const result = await fn(db)
    await db.query('commit')
    return result
  } catch (error) {
    try {
      await db.query('rollback')
    } catch {
      /* connection already broken */
    }
    throw error
  } finally {
    db.release()
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await (db as pg.Pool).query<T>(sql, params as never[])
  return res.rows
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(db, sql, params)
  return rows[0] ?? null
}

export async function ping(): Promise<boolean> {
  try {
    await ownerPool.query('select 1')
    return true
  } catch {
    return false
  }
}
