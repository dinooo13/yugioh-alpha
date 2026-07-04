import { useDb } from '../../../db'
import { useAuth } from '../../../utils/auth'
import { syncCatalog } from '../../../utils/catalog-sync'

/**
 * Triggers a full catalog sync from YGOPRODeck.
 *
 * MVP auth gate: any authenticated session (this is a single-user personal
 * app; a dedicated admin role is deferred — see
 * docs/adr/0001-card-catalog-data-model.md).
 */
export default defineEventHandler(async (event) => {
  const session = await useAuth().api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const result = await syncCatalog(useDb())
  return result
})
