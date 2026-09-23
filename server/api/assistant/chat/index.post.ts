import { readBody, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { createConversation, validateCreateConversationInput } from '../../../utils/assistant-chat'
import { requireUser } from '../../../utils/session'

// Optional body `{ deckId }` links the new conversation to one of the
// caller's decks (docs/adr/0011-deck-assistance-in-chat.md); an empty body
// creates a plain conversation, as before.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = validateCreateConversationInput(await readBody(event))
  const conversation = createConversation(useDb(), user.id, input)

  setResponseStatus(event, 201)
  return conversation
})
