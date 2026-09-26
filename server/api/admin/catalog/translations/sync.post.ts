import { useDb } from '../../../../db'
import { requireAdminToken } from '../../../../utils/admin-token'
import { syncCardTranslations } from '../../../../utils/card-translations-sync'

/**
 * Triggers the German card data sync on its own (ADR 0015). It is skipped
 * when the source repo hasn't changed since the last successful run, and
 * fails until `catalog:sync` has filled the Konami ids.
 *
 * Same admin-token gate as `POST /api/admin/catalog/sync` (ADR 0027).
 */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)

  const result = await syncCardTranslations(useDb())
  return result
})
