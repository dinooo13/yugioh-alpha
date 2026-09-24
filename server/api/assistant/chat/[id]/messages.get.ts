import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../db'
import { loadDeckRef, requireOwnConversation, toConversationSummary } from '../../../../utils/assistant-chat'
import { loadUiMessages } from '../../../../utils/assistant-ui-messages'
import { requireUser } from '../../../../utils/session'
import type { AssistantUIConversation } from '../../../../../shared/assistant-ui'

/**
 * A conversation with its messages as AI SDK UIMessages
 * (docs/adr/0020-assistant-on-the-ai-sdk.md): rows of the former engine
 * converted when read, proposals and deck names refreshed to their current
 * state (#53, #69).
 */
export default defineEventHandler(async (event): Promise<AssistantUIConversation> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found', data: { code: 'conversation_not_found' } })
  }

  const user = await requireUser(event)
  const db = useDb()
  const conversation = requireOwnConversation(db, user.id, id)

  return {
    conversation: toConversationSummary(conversation, loadDeckRef(db, conversation.deckId)),
    messages: loadUiMessages(db, user.id, id),
  }
})
