// Structured data and text for the tool chips of the chat thread
// (`ToolPart.vue`, ADR 0014/0020).
//
// A tool call is a `tool-<name>` part of an assistant message (AI SDK
// UIMessage): its input, its state (running, done, failed) and — once done —
// its output, which holds the result exactly as the model read it and the
// current name of the deck the call refers to (#53); `get_card`'s result
// names the card, so its chip shows the name instead of the id (#128). The
// outcome is derived
// from that result with the same `summarizeToolResult`
// (shared/assistant-chat.ts) whether the part is streaming right now or was
// loaded with the conversation, so both look the same. The text itself is
// built here, in the interface language.

import { isAssistantToolName, summarizeToolResult, toolCallDetail } from '~~/shared/assistant-chat'
import type { AssistantToolCallView, AssistantToolOutcome } from '~~/shared/assistant-chat'
import type { AssistantUIMessagePart } from '~~/shared/assistant-ui'
import type { CardNameFields } from '~~/shared/card-text'

/** A tool call as a chip shows it: the tool, its input, the deck's name (#53) and the card's name (#128). */
export type ToolActivityCall = Pick<AssistantToolCallView, 'name' | 'arguments' | 'deckName'> & { cardName?: string }

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

const DETAIL_MAX_LENGTH = 40

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** "Sucht im Katalog: Dark Magician" — the tool's label, plus the query, name, deck name (#53) or card name (#128) it works on. An unknown tool shows its name. */
export function toolCallLabel(t: Translate, call: ToolActivityCall): string {
  const label = isAssistantToolName(call.name) ? t(`assistant.tool.label.${call.name}`) : call.name
  const detail = toolCallDetail(call)
  return detail ? t('assistant.tool.withDetail', { label, detail: truncate(detail, DETAIL_MAX_LENGTH) }) : label
}

/**
 * The text after a finished chip: the result count, a pending proposal, or
 * "failed" (the raw error goes into the chip's body, see ToolPart.vue).
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

// --- Tool parts (AI SDK UIMessage) ------------------------------------------

/** A tool call part as the thread reads it (`tool-<name>`; legacy conversations may name tools that no longer exist). */
export interface AssistantToolPartLike {
  type: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

export type AssistantActivityState = 'running' | 'ok' | 'error'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isToolPart(part: AssistantUIMessagePart): part is AssistantUIMessagePart & AssistantToolPartLike {
  return part.type.startsWith('tool-') && 'state' in part
}

/**
 * The card a finished `get_card` call read, from its result (`name`, and
 * `nameDe` when the turn ran with German card language); null while it runs,
 * when it failed or when the result holds no card.
 */
function toolPartCard(part: AssistantToolPartLike): CardNameFields | null {
  if (part.type !== 'tool-get_card' || part.state !== 'output-available' || !isRecord(part.output)) {
    return null
  }
  const result = part.output.result
  if (!isRecord(result) || typeof result.name !== 'string' || result.name === '') {
    return null
  }
  return { name: result.name, ...(typeof result.nameDe === 'string' ? { nameDe: result.nameDe } : {}) }
}

/**
 * The call a chip names: the tool, its input, the deck's current name from
 * the output (#53), and — for `get_card` — the card's name from the result,
 * picked by `pickCardName` (the card language, `useCardText().cardName`;
 * #128). Without a name the chip keeps the card's id.
 */
export function toolPartCall(part: AssistantToolPartLike, pickCardName: (card: CardNameFields) => string = card => card.name): ToolActivityCall {
  const output = isRecord(part.output) ? part.output : undefined
  const card = toolPartCard(part)
  return {
    name: part.type.slice('tool-'.length),
    arguments: isRecord(part.input) ? part.input : {},
    ...(typeof output?.deckName === 'string' ? { deckName: output.deckName } : {}),
    ...(card ? { cardName: pickCardName(card) } : {}),
  }
}

/**
 * Where a call stands and what it produced: running until its output is
 * there; failed with the model's error text (`output-error`, or a result
 * that is itself `{ error }`); else done with its result count or pending
 * proposal.
 */
export function toolPartOutcome(part: AssistantToolPartLike): { state: AssistantActivityState, outcome?: AssistantToolOutcome } {
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      return { state: 'running' }
    case 'output-error':
      return { state: 'error', outcome: { error: part.errorText ?? '' } }
    case 'output-available': {
      const result = isRecord(part.output) ? part.output.result : undefined
      const summary = summarizeToolResult(true, result)
      return { state: summary.ok ? 'ok' : 'error', outcome: summary.outcome }
    }
    default:
      return { state: 'ok', outcome: {} }
  }
}
