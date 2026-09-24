import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../db'
import { loadDeckRef, requireOwnConversation, toConversationSummary } from '../../../../utils/assistant-chat'
import { getAssistantStatus } from '../../../../utils/assistant-model'
import { generateConversationTitle } from '../../../../utils/assistant-title'
import { requireUser } from '../../../../utils/session'
import { resolveUiLocale } from '../../../../utils/ui-locale'
import type { AssistantConversationTitleResult } from '../../../../../shared/assistant-chat'

/**
 * After a completed turn the client asks the server to name the
 * conversation (#129): the title model writes a short title in the
 * interface language (server/utils/assistant-title.ts). Idempotent — only an
 * automatic title is replaced — never part of the turn, and it doesn't take
 * the turn lock. `generated` = the title changed; a failing or unconfigured
 * title model keeps the title and is no error.
 */
export default defineEventHandler(async (event): Promise<AssistantConversationTitleResult> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found', data: { code: 'conversation_not_found' } })
  }

  const user = await requireUser(event)
  const db = useDb()

  if (!getAssistantStatus().chat) {
    const conversation = requireOwnConversation(db, user.id, id)
    return { conversation: toConversationSummary(conversation, loadDeckRef(db, conversation.deckId)), generated: false }
  }

  const locale = await resolveUiLocale(event)
  return generateConversationTitle({ db, userId: user.id, conversationId: id, locale })
})
