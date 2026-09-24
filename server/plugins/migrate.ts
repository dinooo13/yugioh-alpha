import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { useDb } from '../db'
import { seedCatalogFixture } from '../db/fixtures/catalog-fixture'
import { backfillCatalogNameSearch } from '../utils/catalog-sync'
import { seedBuiltinFormats } from '../utils/rule-formats'

/**
 * Applies pending Drizzle migrations at server startup so the app
 * works out of the box without a manual migration step, fills the folded
 * search name of catalog cards that don't have one yet (ADR 0015; a no-op
 * after the first boot), then upserts the built-in rule formats (see
 * docs/adr/0005-rule-format-model.md) so their rules ship with the code
 * instead of needing a data migration.
 *
 * When `e2eSeedCatalog` is explicitly enabled (Playwright's webServer sets
 * NUXT_E2E_SEED_CATALOG=1), also upserts the small deterministic E2E catalog
 * fixture so E2E specs can search/filter a known set of cards. This never
 * runs in normal dev/production startups.
 */
export default defineNitroPlugin(() => {
  const db = useDb()
  migrate(db, { migrationsFolder: './server/db/migrations' })
  backfillCatalogNameSearch(db)
  seedBuiltinFormats(db)

  // Nitro's env-var override for runtime config runs values through `destr`,
  // so NUXT_E2E_SEED_CATALOG=1 arrives here as the *number* 1, not the
  // string '1' — compare as a string to accept both the number and the
  // string default.
  if (String(useRuntimeConfig().e2eSeedCatalog) === '1') {
    seedCatalogFixture(db)
  }
})
