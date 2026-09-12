import { useDb } from '../../../db'
import { listConversations } from '../../../utils/assistant-chat'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return { items: listConversations(useDb(), user.id) }
})
