import { setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { createConversation } from '../../../utils/assistant-chat'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const conversation = createConversation(useDb(), user.id)

  setResponseStatus(event, 201)
  return conversation
})
