import { createError, getRouterParam } from 'h3'
import { useDb } from '../../db'
import { getRuleFormat } from '../../utils/rule-formats'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Format not found' })
  }

  const user = await requireUser(event)

  return getRuleFormat(useDb(), user.id, id)
})
