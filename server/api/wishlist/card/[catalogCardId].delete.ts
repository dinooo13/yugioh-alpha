import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { removeWishlistItemByCard } from '../../../utils/wishlist'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, 'catalogCardId')
  const catalogCardId = Number(raw)
  if (!raw || !Number.isInteger(catalogCardId) || catalogCardId < 1) {
    throw createError({ statusCode: 404, statusMessage: 'Wishlist item not found' })
  }

  const user = await requireUser(event)
  removeWishlistItemByCard(useDb(), user.id, catalogCardId)
  setResponseStatus(event, 204)
})
