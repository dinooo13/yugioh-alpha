import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { deleteOwnedCard } from '../../utils/inventory'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Owned card not found' })
  }

  const user = await requireUser(event)
  await deleteOwnedCard(useDb(), user.id, id)
  setResponseStatus(event, 204)
})
