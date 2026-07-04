import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { useDb } from '../db'

/**
 * Applies pending Drizzle migrations at server startup so the app
 * works out of the box without a manual migration step.
 */
export default defineNitroPlugin(() => {
  migrate(useDb(), { migrationsFolder: './server/db/migrations' })
})
