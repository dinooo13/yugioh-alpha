import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { useDb } from '../db'
import { seedCatalogFixture } from '../db/fixtures/catalog-fixture'

/**
 * Applies pending Drizzle migrations at server startup so the app
 * works out of the box without a manual migration step.
 *
 * When `e2eSeedCatalog` is explicitly enabled (Playwright's webServer sets
 * NUXT_E2E_SEED_CATALOG=1), also upserts the small deterministic E2E catalog
 * fixture so E2E specs can search/filter a known set of cards. This never
 * runs in normal dev/production startups.
 */
export default defineNitroPlugin(() => {
  const db = useDb()
  migrate(db, { migrationsFolder: './server/db/migrations' })

  // Nitro's env-var override for runtime config runs values through `destr`,
  // so NUXT_E2E_SEED_CATALOG=1 arrives here as the *number* 1, not the
  // string '1' — compare as a string to accept both the number and the
  // string default.
  if (String(useRuntimeConfig().e2eSeedCatalog) === '1') {
    seedCatalogFixture(db)
  }
})
