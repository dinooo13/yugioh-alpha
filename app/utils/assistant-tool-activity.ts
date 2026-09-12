// Builds the label/summary text for `ToolActivity.vue` chips.
//
// While a turn is streaming, the server already sends a fully-formed label
// (`tool_call` event) and summary (`tool_result` event) — see
// server/utils/assistant-chat.ts buildToolCallLabel/summarizeToolOutcome.
// Once a conversation is reloaded from `GET /api/assistant/chat/:id`,
// though, only the raw persisted rows are available (an assistant message's
// `toolCalls: [{ id, name, arguments }]`, and the matching `tool` message's
// JSON `content`) — this file rebuilds the same text from those so a
// reloaded thread looks identical to a freshly streamed one.

import { ASSISTANT_TOOL_LABELS } from '~~/shared/assistant-chat'
import type { AssistantToolCallView } from '~~/shared/assistant-chat'

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Mirrors server/utils/assistant-chat.ts buildToolCallLabel, working off
 * the already-parsed `arguments` object instead of a raw JSON string. */
export function toolCallLabel(call: Pick<AssistantToolCallView, 'name' | 'arguments'>): string {
  const base = ASSISTANT_TOOL_LABELS[call.name] ?? call.name
  const args = call.arguments

  const detail = typeof args.query === 'string'
    ? args.query
    : typeof args.name === 'string'
      ? args.name
      : typeof args.deckId === 'string'
        ? args.deckId
        : typeof args.id === 'number' || typeof args.id === 'string'
          ? String(args.id)
          : undefined

  return detail ? `${base}: ${truncate(detail, 40)}` : base
}

export interface ToolResultSummary {
  ok: boolean
  summary: string
}

/** Mirrors server/utils/assistant-chat.ts summarizeToolOutcome, working off
 * a persisted `role: 'tool'` message's `content` (the JSON-serialized
 * result the model saw). */
export function summarizeStoredToolResult(content: string): ToolResultSummary {
  let parsed: unknown
  try {
    parsed = content.trim() === '' ? null : JSON.parse(content)
  }
  catch {
    return { ok: true, summary: 'OK' }
  }

  if (isRecord(parsed) && typeof parsed.error === 'string') {
    return { ok: false, summary: parsed.error }
  }
  if (Array.isArray(parsed)) {
    return { ok: true, summary: `${parsed.length} Ergebnis(se)` }
  }
  if (isRecord(parsed) && typeof parsed.summary === 'string') {
    return { ok: true, summary: parsed.summary }
  }
  return { ok: true, summary: 'OK' }
}
