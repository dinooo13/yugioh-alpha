import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../db'
import { finishTournament } from '../../../utils/tournaments'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)

  return finishTournament(useDb(), user.id, id)
})
