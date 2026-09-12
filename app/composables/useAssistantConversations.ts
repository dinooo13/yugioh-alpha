import type { AssistantConversationListItem } from '~~/shared/assistant-chat'

export interface AssistantConversationsResponse {
  items: AssistantConversationListItem[]
}

/**
 * The signed-in user's chat conversations (newest first, per
 * `GET /api/assistant/chat`). Shared `key` so the `/assistent` empty-state
 * redirect check and the `ConversationList` sidebar reuse one request/cache
 * instead of issuing their own.
 */
export function useAssistantConversations() {
  return useFetch<AssistantConversationsResponse>('/api/assistant/chat', {
    key: 'assistant-conversations',
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
    default: () => ({ items: [] }),
  })
}
