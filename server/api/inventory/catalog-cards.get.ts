import { getQuery } from 'h3'
import { useDb } from '../../db'
import { searchCatalogCards } from '../../utils/inventory'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const query = getQuery(event)

  return {
    items: searchCatalogCards(useDb(), typeof query.q === 'string' ? query.q : ''),
  }
})
