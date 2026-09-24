import { setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { createConversation } from '../../../utils/assistant-chat'
import { requireUser } from '../../../utils/session'
import { resolveUiLocale } from '../../../utils/ui-locale'

// Creates a plain conversation, titled in the interface language of the
// request (ADR 0014). Any request body is ignored — clients from before
// ADR 0021 that still send `{ deckId }` get a plain conversation too.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const conversation = createConversation(useDb(), user.id, await resolveUiLocale(event))

  setResponseStatus(event, 201)
  return conversation
})
