import { getDeckAssistantStatus } from '../../utils/deck-assistant-model'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return getDeckAssistantStatus()
})
