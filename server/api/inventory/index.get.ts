import { getQuery } from 'h3'
import { useDb } from '../../db'
import { requireCollectionOwnedByUser } from '../../utils/collections'
import { listOwnedCards } from '../../utils/inventory'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = getQuery(event)
  const db = useDb()

  const collectionId = typeof query.collectionId === 'string' ? query.collectionId : undefined
  if (collectionId) {
    requireCollectionOwnedByUser(db, user.id, collectionId)
  }

  return listOwnedCards(db, user.id, {
    q: typeof query.q === 'string' ? query.q : undefined,
    page: typeof query.page === 'string' ? Number(query.page) : undefined,
    pageSize: typeof query.pageSize === 'string' ? Number(query.pageSize) : undefined,
    collectionId,
  })
})
