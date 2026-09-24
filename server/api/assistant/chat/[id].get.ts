import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../db'
import { loadDeckRef, requireOwnConversation, toConversationSummary } from '../../../utils/assistant-chat'
import { requireUser } from '../../../utils/session'
import type { AssistantConversationSummary } from '../../../../shared/assistant-chat'

/** One conversation's summary (title, deck link); its messages come from `GET …/:id/messages`. */
export default defineEventHandler(async (event): Promise<{ conversation: AssistantConversationSummary }> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found', data: { code: 'conversation_not_found' } })
  }

  const user = await requireUser(event)
  const db = useDb()
  const conversation = requireOwnConversation(db, user.id, id)

  return { conversation: toConversationSummary(conversation, loadDeckRef(db, conversation.deckId)) }
})
