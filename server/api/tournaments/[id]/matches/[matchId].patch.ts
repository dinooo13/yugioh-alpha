import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../db'
import { reportMatchResult } from '../../../../utils/tournaments'
import { requireUser } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const matchId = getRouterParam(event, 'matchId')
  if (!id || !matchId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  const body = await readBody(event)

  return reportMatchResult(useDb(), user.id, id, matchId, body)
})
