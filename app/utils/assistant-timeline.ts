import type { AssistantActionView, AssistantAttachment } from '~~/shared/assistant-chat'

export type AssistantActivityStatus = 'running' | 'ok' | 'error'

/**
 * One renderable row of a conversation thread. Built by
 * `useAssistantThread` from either persisted messages/actions (a reloaded
 * conversation) or live SSE events (the turn currently streaming) — see
 * that composable for how the two are merged into the same shape so
 * `MessageThread.vue` never needs to know which one it's looking at.
 */
export type AssistantTimelineItem =
  | { type: 'message', key: string, role: 'user' | 'assistant', content: string, attachments?: AssistantAttachment[] }
  | { type: 'activity', key: string, label: string, status: AssistantActivityStatus, summary?: string }
  | { type: 'action', key: string, action: AssistantActionView }
