import { getQuery } from 'h3'
import { useDb } from '../../db'
import { searchCatalogCards } from '../../utils/inventory'
import { requireUser } from '../../utils/session'
import { resolveCardLocale } from '../../utils/ui-locale'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const query = getQuery(event)
  const cardLocale = await resolveCardLocale(event)

  return {
    items: searchCatalogCards(useDb(), typeof query.q === 'string' ? query.q : '', cardLocale),
  }
})
