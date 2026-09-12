import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../db'
import { updateParticipant, validateParticipantUpdateInput } from '../../../../utils/tournaments'
import { requireUser } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const participantId = getRouterParam(event, 'participantId')
  if (!id || !participantId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  const patch = validateParticipantUpdateInput(await readBody(event))

  return updateParticipant(useDb(), user.id, id, participantId, patch)
})
