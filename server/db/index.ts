import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

let sqlite: Database.Database | undefined
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined

function resolveDbPath(): string {
  const config = useRuntimeConfig()
  const dbFilePath = config.dbFilePath || './data/app.db'
  return resolve(dbFilePath)
}

/**
 * Singleton Drizzle client backed by better-sqlite3.
 * The containing directory is created on first access if missing.
 */
export function useDb() {
  if (!dbInstance) {
    const dbPath = resolveDbPath()
    mkdirSync(dirname(dbPath), { recursive: true })
    sqlite = new Database(dbPath)
    sqlite.pragma('journal_mode = WAL')
    dbInstance = drizzle(sqlite, { schema })
  }
  return dbInstance
}

export function useSqlite() {
  if (!sqlite) {
    useDb()
  }
  return sqlite!
}
