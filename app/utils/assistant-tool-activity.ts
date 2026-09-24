// Structured data and text for `ToolActivity.vue` chips (ADR 0014).
//
// While a turn is streaming, the server sends the call structured
// (`tool_call`: name, parsed arguments, the deck's name — #53) and its
// outcome (`tool_result`: count/truncated/pending/error). Once a conversation
// is reloaded from `GET /api/assistant/chat/:id`, the same call comes from an
// assistant message's `toolCalls` and the outcome is derived from the
// matching `tool` message's JSON content with the very same
// `summarizeToolResult` (shared/assistant-chat.ts) the server used — so a
// reloaded thread looks identical to a freshly streamed one. The text itself
// is built here, in the interface language.

import { isAssistantToolName, summarizeToolResult, toolCallDetail } from '~~/shared/assistant-chat'
import type { AssistantToolCallView, AssistantToolOutcome } from '~~/shared/assistant-chat'

/** A tool call as a chip shows it (the persisted/streamed call, minus its id). */
export type ToolActivityCall = Pick<AssistantToolCallView, 'name' | 'arguments' | 'deckName'>

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

const DETAIL_MAX_LENGTH = 40

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The outcome of a persisted `role: 'tool'` message's `content` (the JSON-serialized result the model saw). */
export function storedToolResultOutcome(content: string): { ok: boolean, outcome: AssistantToolOutcome } {
  let parsed: unknown
  try {
    parsed = content.trim() === '' ? null : JSON.parse(content)
  }
  catch {
    return { ok: true, outcome: {} }
  }
  return summarizeToolResult(true, parsed)
}

/** "Sucht im Katalog: Dark Magician" — the tool's label, plus the query, name or deck name (#53) it works on. An unknown tool shows its name. */
export function toolCallLabel(t: Translate, call: ToolActivityCall): string {
  const label = isAssistantToolName(call.name) ? t(`assistant.tool.label.${call.name}`) : call.name
  const detail = toolCallDetail(call)
  return detail ? t('assistant.tool.withDetail', { label, detail: truncate(detail, DETAIL_MAX_LENGTH) }) : label
}

/**
 * The text after a finished chip: the result count, a pending proposal, or
 * "failed" (the raw error goes into the chip's tooltip, see ToolActivity.vue).
 * `formatCount` formats the number in the interface language.
 */
export function toolOutcomeSummary(t: Translate, ok: boolean, outcome: AssistantToolOutcome, formatCount: (count: number) => string): string {
  if (!ok) {
    return t('assistant.tool.failed')
  }
  if (outcome.count !== undefined) {
    const key = outcome.truncated ? 'assistant.tool.outcome.atLeast' : 'assistant.tool.outcome.results'
    return t(key, { count: formatCount(outcome.count) }, outcome.count)
  }
  if (outcome.pending) {
    return t('assistant.tool.outcome.pending')
  }
  return t('assistant.tool.outcome.done')
}
