import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../db'
import { getConversationDetail } from '../../../utils/assistant-chat'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found', data: { code: 'conversation_not_found' } })
  }

  const user = await requireUser(event)

  return getConversationDetail(useDb(), user.id, id)
})
