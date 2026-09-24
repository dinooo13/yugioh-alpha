import type { AssistantStatus } from '../../../shared/assistant-chat'
import { getAssistantStatus } from '../../utils/assistant-model'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<AssistantStatus> => {
  await requireUser(event)
  return getAssistantStatus()
})
