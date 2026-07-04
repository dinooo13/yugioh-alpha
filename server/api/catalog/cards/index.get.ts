import { useDb } from '../../../db'
import { parseCardListQuery } from '../../../utils/catalog-query'
import { searchCatalogCards } from '../../../utils/catalog-search'
import { requireSession } from '../../../utils/require-session'

export default defineEventHandler(async (event) => {
  await requireSession(event)

  const filters = parseCardListQuery(getQuery(event))
  return searchCatalogCards(useDb(), filters)
})
