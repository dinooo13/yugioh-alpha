import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { removeWishlistItem } from '../../utils/wishlist'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Wishlist item not found' })
  }

  const user = await requireUser(event)
  removeWishlistItem(useDb(), user.id, id)
  setResponseStatus(event, 204)
})
