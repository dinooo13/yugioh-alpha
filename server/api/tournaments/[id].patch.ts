import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../db'
import { updateTournament, validateTournamentUpdateInput } from '../../utils/tournaments'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  const patch = validateTournamentUpdateInput(await readBody(event))

  return updateTournament(useDb(), user.id, id, patch)
})
