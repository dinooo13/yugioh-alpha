import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../../db'
import { toActionView } from '../../../../../utils/assistant-chat'
import { rejectAction } from '../../../../../utils/assistant-tools'
import { requireUser } from '../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Vorschlag nicht gefunden.' })
  }

  const user = await requireUser(event)
  const action = rejectAction(useDb(), user.id, id)

  return { action: toActionView(action) }
})
