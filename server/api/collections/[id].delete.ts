import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { deleteCollection } from '../../utils/collections'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  }

  const user = await requireUser(event)
  await deleteCollection(useDb(), user.id, id)
  setResponseStatus(event, 204)
})
