import { useDb } from '../../db'
import { wishlistCardIds } from '../../utils/wishlist'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return { ids: wishlistCardIds(useDb(), user.id) }
})
