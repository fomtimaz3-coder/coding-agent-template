import * as schema from './schema'

const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || ''
const useSqlite = !postgresUrl || postgresUrl.trim() === ''

// Dialect-agnostic type — concrete driver is selected at runtime
type DbInstance = any

let _db: DbInstance | null = null

function createDb(): DbInstance {
  if (useSqlite) {
    // Dynamic require so the native module is only loaded when needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3')

    const sqlitePath = (process.env.SQLITE_URL || 'local.db').replace(/^file:/, '')
    const sqlite = new Database(sqlitePath)
    // Reasonable defaults for local dev
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    return drizzle(sqlite, { schema })
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const postgres = require('postgres') as typeof import('postgres')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/postgres-js') as typeof import('drizzle-orm/postgres-js')

  const client = postgres(postgresUrl)
  return drizzle(client, { schema })
}

/**
 * Lazy database client.
 * - When POSTGRES_URL is set → Postgres (Neon / any Postgres)
 * - When POSTGRES_URL is unset → SQLite via better-sqlite3 (local.db)
 */
export const db = new Proxy({} as DbInstance, {
  get(_target, prop) {
    if (!_db) {
      _db = createDb()
    }
    return Reflect.get(_db, prop)
  },
})

/** True when running against the local SQLite fallback */
export const isSqlite = useSqlite
