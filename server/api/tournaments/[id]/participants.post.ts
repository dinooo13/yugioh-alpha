import { createError, getRouterParam, readBody, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { addParticipant, validateParticipantInput } from '../../../utils/tournaments'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  const input = validateParticipantInput(await readBody(event))
  const detail = addParticipant(useDb(), user.id, id, input)

  setResponseStatus(event, 201)
  return detail
})
