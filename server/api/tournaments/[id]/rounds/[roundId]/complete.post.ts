import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../../db'
import { completeRound } from '../../../../../utils/tournaments'
import { requireUser } from '../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const roundId = getRouterParam(event, 'roundId')
  if (!id || !roundId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)

  return completeRound(useDb(), user.id, id, roundId)
})
