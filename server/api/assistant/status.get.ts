import type { AssistantStatus } from '../../../shared/assistant-chat'
import { getDeckAssistantStatus } from '../../utils/deck-assistant-model'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<AssistantStatus> => {
  await requireUser(event)
  return getDeckAssistantStatus()
})
