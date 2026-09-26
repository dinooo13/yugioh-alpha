import { useDb } from '../../../db'
import { requireAdminToken } from '../../../utils/admin-token'
import { refreshCatalog } from '../../../utils/catalog-refresh'

/**
 * Triggers a full catalog refresh: the YGOPRODeck card sync, then the German
 * card data sync (best effort, reported under `translations`; ADR 0015).
 *
 * Needs the admin token (`Authorization: Bearer <NUXT_ADMIN_TOKEN>`,
 * ADR 0027); a signed-in session alone isn't enough.
 */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)

  const result = await refreshCatalog(useDb())
  return result
})
