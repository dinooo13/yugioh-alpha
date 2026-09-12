import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../db'
import { deleteTournament } from '../../utils/tournaments'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  deleteTournament(useDb(), user.id, id)
  setResponseStatus(event, 204)
})
