import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../db'
import { updateOwnedCard, validateInventoryUpdateInput } from '../../utils/inventory'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Owned card not found' })
  }

  const user = await requireUser(event)
  const input = validateInventoryUpdateInput(await readBody(event))

  return updateOwnedCard(useDb(), user.id, id, input)
})
