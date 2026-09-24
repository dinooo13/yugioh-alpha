import { useDb } from '../../../../db'
import { useAuth } from '../../../../utils/auth'
import { syncCardTranslations } from '../../../../utils/card-translations-sync'

/**
 * Triggers the German card data sync on its own (ADR 0015). It is skipped
 * when the source repo hasn't changed since the last successful run, and
 * fails until `catalog:sync` has filled the Konami ids.
 *
 * Same MVP auth gate as `POST /api/admin/catalog/sync`: any authenticated
 * session (docs/adr/0001-card-catalog-data-model.md).
 */
export default defineEventHandler(async (event) => {
  const session = await useAuth().api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const result = await syncCardTranslations(useDb())
  return result
})
