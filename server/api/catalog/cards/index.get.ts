import { useDb } from '../../../db'
import { parseCardListQuery } from '../../../utils/catalog-query'
import { searchCatalog } from '../../../utils/catalog-search'
import { requireUser } from '../../../utils/session'
import { resolveCardLocale } from '../../../utils/ui-locale'

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const filters = parseCardListQuery(getQuery(event))
  return searchCatalog(useDb(), filters, await resolveCardLocale(event))
})
