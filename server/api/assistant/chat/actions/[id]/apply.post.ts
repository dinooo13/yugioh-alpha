import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../../db'
import { toActionView } from '../../../../../utils/assistant-chat'
import { applyAction } from '../../../../../utils/assistant-tools'
import { requireUser } from '../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Action not found', data: { code: 'action_not_found' } })
  }

  const user = await requireUser(event)
  const action = await applyAction(useDb(), user.id, id)

  return { action: toActionView(action) }
})
