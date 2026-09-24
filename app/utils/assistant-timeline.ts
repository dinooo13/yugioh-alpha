import type { AssistantActionView, AssistantAttachment, AssistantToolOutcome } from '~~/shared/assistant-chat'
import type { ToolActivityCall } from '~/utils/assistant-tool-activity'

export type AssistantActivityStatus = 'running' | 'ok' | 'error'

/**
 * One renderable row of a conversation thread. Built by
 * `useAssistantThread` from either persisted messages/actions (a reloaded
 * conversation) or live SSE events (the turn currently streaming) — see
 * that composable for how the two are merged into the same shape so
 * `MessageThread.vue` never needs to know which one it's looking at. Tool
 * activity stays structured; `ToolActivity.vue` renders its text in the
 * interface language.
 */
export type AssistantTimelineItem =
  | { type: 'message', key: string, role: 'user' | 'assistant', content: string, attachments?: AssistantAttachment[] }
  | { type: 'activity', key: string, call: ToolActivityCall, status: AssistantActivityStatus, outcome?: AssistantToolOutcome }
  | { type: 'action', key: string, action: AssistantActionView }
