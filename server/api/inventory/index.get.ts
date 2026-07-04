import { getQuery } from 'h3'
import { useDb } from '../../db'
import { listOwnedCards } from '../../utils/inventory'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = getQuery(event)

  return listOwnedCards(useDb(), user.id, {
    q: typeof query.q === 'string' ? query.q : undefined,
    page: typeof query.page === 'string' ? Number(query.page) : undefined,
    pageSize: typeof query.pageSize === 'string' ? Number(query.pageSize) : undefined,
  })
})
