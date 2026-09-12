import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { addWishlistItem, validateWishlistInput } from '../../utils/wishlist'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = validateWishlistInput(await readBody(event))
  const item = addWishlistItem(useDb(), user.id, input)

  setResponseStatus(event, 201)
  return item
})
