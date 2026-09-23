import type { AssistantStatus } from '~~/shared/assistant-chat'

/**
 * `GET /api/assistant/status` — whether the chat assistant is configured on
 * this server. Shared `key`, so the assistant pages and the deck editor's
 * "Mit KI bearbeiten" button reuse one request/cache; defaults to
 * "disabled" until (or unless) the server says otherwise.
 */
export function useAssistantStatus() {
  return useFetch<AssistantStatus>('/api/assistant/status', {
    key: 'assistant-status',
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
    default: () => ({ enabled: false, provider: null, model: null, chat: false, vision: false, visionModel: null }),
  })
}
