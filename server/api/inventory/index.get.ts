import { getQuery } from 'h3'
import { useDb } from '../../db'
import { requireCollectionOwnedByUser } from '../../utils/collections'
import { listOwnedCards, parseInventoryListQuery } from '../../utils/inventory'
import { requireUser } from '../../utils/session'
import { UNASSIGNED_COLLECTION_ID } from '../../../shared/inventory'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const options = parseInventoryListQuery(getQuery(event))
  const db = useDb()

  // `__none__` ("(keine Sammlung)") is not a collection row, so there is
  // nothing to check ownership of.
  if (options.collectionId && options.collectionId !== UNASSIGNED_COLLECTION_ID) {
    requireCollectionOwnedByUser(db, user.id, options.collectionId)
  }

  return listOwnedCards(db, user.id, options)
})
