import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'

// Load .env.local / .env so drizzle-kit sees the same vars as the app
config({ path: '.env.local' })
config()

const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || ''
const sqliteUrl = process.env.SQLITE_URL || 'file:local.db'

// Auto-detect: use SQLite when no Postgres URL is provided
const useSqlite = !postgresUrl || postgresUrl.trim() === ''

export default defineConfig(
  useSqlite
    ? {
        schema: './lib/db/schema.sqlite.ts',
        out: './lib/db/migrations-sqlite',
        dialect: 'sqlite',
        dbCredentials: {
          url: sqliteUrl.startsWith('file:') ? sqliteUrl : `file:${sqliteUrl}`,
        },
      }
    : {
        schema: './lib/db/schema.pg.ts',
        out: './lib/db/migrations',
        dialect: 'postgresql',
        dbCredentials: {
          url: postgresUrl,
        },
      },
)
