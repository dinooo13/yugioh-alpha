import { useDb } from '../../../db'
import { useAuth } from '../../../utils/auth'
import { refreshCatalog } from '../../../utils/catalog-refresh'

/**
 * Triggers a full catalog refresh: the YGOPRODeck card sync, then the German
 * card data sync (best effort, reported under `translations`; ADR 0015).
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

  const result = await refreshCatalog(useDb())
  return result
})
