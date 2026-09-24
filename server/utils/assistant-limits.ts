// Configurable operational limits for the chat assistant (Phase 8, see
// docs/adr/0010-chat-assistant-with-tools.md): how many tool-calling rounds
// a turn may run, how much of a tool result and how much history the model
// gets to see, and how long a single model call may take. Read from
// `runtimeConfig.assistant.limits` (see nuxt.config.ts for the defaults and
// .env.example for the six `NUXT_ASSISTANT_LIMITS_*` overrides), consumed by
// the turn (assistant-turn.ts), the history window (assistant-ui-messages.ts)
// and the tool layer (assistant-tools.ts).
//
// The app currently has a single user who watches costs, not an untrusted
// multi-tenant crowd — so a garbage/missing override falls back to a
// generous default rather than a strict one, but every value is still
// bounded well away from "unbounded" (a stuck loop, a multi-megabyte
// history, a request that never times out).
//
// Nitro already parses a numeric `NUXT_ASSISTANT_LIMITS_*` value through
// `destr` before it reaches `runtimeConfig`, so a real deployment sees a
// `number` here; a numeric string is accepted too so a hand-edited
// `nuxt.config.ts` default or a config layer that leaves it as a string
// still works.

/** Tool-calling rounds (model steps) per user turn — server/utils/assistant-turn.ts. */
export const DEFAULT_ASSISTANT_MAX_TOOL_ROUNDS = 24
/** Rows a read tool returns, and the floor read tools' write counterparts (`items`/`changes`) are capped at — server/utils/assistant-tools.ts. */
export const DEFAULT_ASSISTANT_TOOL_RESULT_MAX_ITEMS = 100
/** Serialized tool result budget, in characters — server/utils/assistant-tools.ts. */
export const DEFAULT_ASSISTANT_TOOL_RESULT_MAX_CHARS = 60_000
/** Prior messages sent to the model as history — server/utils/assistant-ui-messages.ts. */
export const DEFAULT_ASSISTANT_HISTORY_MESSAGE_LIMIT = 120
/** History character budget, oldest messages dropped first once exceeded — server/utils/assistant-ui-messages.ts. */
export const DEFAULT_ASSISTANT_HISTORY_CHAR_LIMIT = 160_000
/** Timeout for a single model call (one step), in milliseconds — server/utils/assistant-turn.ts. */
export const DEFAULT_ASSISTANT_TIMEOUT_MS = 300_000

export interface AssistantLimits {
  maxToolRounds: number
  toolResultItems: number
  toolResultChars: number
  historyMessages: number
  historyChars: number
  timeoutMs: number
}

/** The shape of `runtimeConfig.assistant.limits` — every field arrives as `unknown` since it may have come straight from an env var. */
interface AssistantLimitsRuntimeConfig {
  maxToolRounds?: unknown
  toolResultItems?: unknown
  toolResultChars?: unknown
  historyMessages?: unknown
  historyChars?: unknown
  timeoutMs?: unknown
}

// Generous, but never so high that a garbage or careless override could
// make the turn loop run away, a serialized tool result or history balloon
// past what's reasonable to ever send a model, or a request hang far longer
// than any real provider would need.
const UPPER_BOUNDS: Record<keyof AssistantLimits, number> = {
  maxToolRounds: 200,
  toolResultItems: 2_000,
  toolResultChars: 2_000_000,
  historyMessages: 2_000,
  historyChars: 4_000_000,
  timeoutMs: 30 * 60 * 1000,
}

/** A positive integer in `[1, max]`, or `fallback` for anything else — undefined/null, 0 or negative, non-integer, `NaN`, or a non-numeric string. */
function positiveIntOr(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return fallback
  }
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue < 1) {
    return fallback
  }
  return Math.min(numberValue, max)
}

/**
 * Resolves the six configurable assistant limits from `runtimeConfig`,
 * falling back to the `DEFAULT_*` constants above for anything unset or
 * invalid. Cheap enough to call per tool invocation or per model call —
 * `useRuntimeConfig()` itself is a cached lookup, not an I/O call.
 */
export function getAssistantLimits(): AssistantLimits {
  const assistantConfig = useRuntimeConfig().assistant as { limits?: AssistantLimitsRuntimeConfig } | undefined
  const config = assistantConfig?.limits ?? {}

  return {
    maxToolRounds: positiveIntOr(config.maxToolRounds, DEFAULT_ASSISTANT_MAX_TOOL_ROUNDS, UPPER_BOUNDS.maxToolRounds),
    toolResultItems: positiveIntOr(config.toolResultItems, DEFAULT_ASSISTANT_TOOL_RESULT_MAX_ITEMS, UPPER_BOUNDS.toolResultItems),
    toolResultChars: positiveIntOr(config.toolResultChars, DEFAULT_ASSISTANT_TOOL_RESULT_MAX_CHARS, UPPER_BOUNDS.toolResultChars),
    historyMessages: positiveIntOr(config.historyMessages, DEFAULT_ASSISTANT_HISTORY_MESSAGE_LIMIT, UPPER_BOUNDS.historyMessages),
    historyChars: positiveIntOr(config.historyChars, DEFAULT_ASSISTANT_HISTORY_CHAR_LIMIT, UPPER_BOUNDS.historyChars),
    timeoutMs: positiveIntOr(config.timeoutMs, DEFAULT_ASSISTANT_TIMEOUT_MS, UPPER_BOUNDS.timeoutMs),
  }
}
