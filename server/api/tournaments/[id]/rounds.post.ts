import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { createNextRound } from '../../../utils/tournaments'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  const detail = createNextRound(useDb(), user.id, id)

  setResponseStatus(event, 201)
  return detail
})
