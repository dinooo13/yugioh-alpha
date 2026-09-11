import { useDb } from '../../db'
import { getCatalogFacets } from '../../utils/catalog-search'
import { requireUser } from '../../utils/session'

const FACET_CACHE_TTL_MS = 60_000
let cachedAt = 0
let cachedFacets: Awaited<ReturnType<typeof getCatalogFacets>> | undefined

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const now = Date.now()
  if (!cachedFacets || now - cachedAt > FACET_CACHE_TTL_MS) {
    cachedFacets = await getCatalogFacets(useDb())
    cachedAt = now
  }

  return cachedFacets
})
