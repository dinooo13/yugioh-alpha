import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../db'
import { updateWishlistItem, validateWishlistUpdateInput } from '../../utils/wishlist'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Wishlist item not found' })
  }

  const user = await requireUser(event)
  const patch = validateWishlistUpdateInput(await readBody(event))

  return updateWishlistItem(useDb(), user.id, id, patch)
})
