import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../db'
import { updateCollection, validateCollectionUpdateInput } from '../../utils/collections'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  }

  const user = await requireUser(event)
  const input = validateCollectionUpdateInput(await readBody(event))

  return updateCollection(useDb(), user.id, id, input)
})
