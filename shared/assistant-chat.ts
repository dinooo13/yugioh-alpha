// Shared contract for the chat assistant with tools (Phase 8), used by both
// the server (server/utils/assistant-*.ts, server/api/assistant/chat/**) and
// the UI. Intentionally dependency-free beyond other pure shared modules, so
// the UI can import types without pulling in server code. No UI copy lives
// here (ADR 0014): the UI renders tool activity, actions and errors from the
// structured values below in the interface language. See
// docs/adr/0010-chat-assistant-with-tools.md and
// docs/adr/0011-deck-assistance-in-chat.md.

import type { DeckWarning, ValidationIssue } from './rule-formats'

/** `GET /api/assistant/status` — whether (and how) the assistant is configured on this server. */
export interface AssistantStatus {
  enabled: boolean
  provider: 'openai' | 'fake' | null
  /** The default model (same as `defaultModel`). */
  model: string | null
  /** The models the user may pick from (`NUXT_ASSISTANT_MODELS`); just the default when no list is configured, empty when disabled. */
  models: string[]
  /** The model a turn uses when none is picked. */
  defaultModel: string | null
  /** For provider 'openai': the endpoint's host (never a key). */
  baseUrl?: string | null
  /** Whether the chat assistant (`/assistant`) is usable — same as `enabled`. */
  chat: boolean
  /** Whether chat turns may include images — true whenever the assistant is enabled. */
  vision: boolean
  /** The model used for image-containing chat turns when a vision model is configured; null = falls back to `model`. */
  visionModel: string | null
}

/** A tool call as the former engine persisted it (`assistant_message.tool_calls`) and as a chip names it — arguments already parsed to an object. */
export interface AssistantToolCallView {
  id: string
  name: string
  arguments: Record<string, unknown>
  /**
   * Display-only (#53): the current name of the caller's deck the call
   * refers to (`toolCallDeckId`), resolved when the conversation is read —
   * never persisted. Missing when the call has no deck or the deck is gone.
   */
  deckName?: string
}

export type AssistantActionKind = 'add_to_inventory' | 'create_deck' | 'update_deck_cards' | 'set_deck_format'
export type AssistantActionStatus = 'pending' | 'applied' | 'rejected' | 'failed'

export interface AssistantActionView {
  id: string
  messageId: string
  kind: AssistantActionKind
  summary: string
  payload: Record<string, unknown>
  status: AssistantActionStatus
  result?: unknown
  /**
   * Display only (#69), resolved when the action is read and never
   * persisted: the current name of the deck `payload.deckId` refers to (for
   * actions stored before the payload carried `deckName`), and the names of
   * the collections `add_to_inventory` items go to. `null` = the deck or
   * collection is gone (or not the caller's). Missing when there is nothing
   * to resolve.
   */
  display?: AssistantActionDisplay
}

export interface AssistantActionDisplay {
  deckName?: string | null
  collectionNames?: Record<string, string | null>
}

export interface AssistantConversationListItem {
  id: string
  title: string
  updatedAt: string
}

/** Max length of a conversation title (server-side truncation). */
export const ASSISTANT_CONVERSATION_TITLE_MAX = 80

export interface AssistantConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

/** User messages up to which a conversation may still get a model-generated title (#129). */
export const ASSISTANT_TITLE_MAX_USER_MESSAGES = 3

/** `POST /api/assistant/chat/:id/title` — the conversation, and whether the model just named it (#129). */
export interface AssistantConversationTitleResult {
  conversation: AssistantConversationSummary
  generated: boolean
}

/**
 * What a proposed deck (a `create_deck` / `update_deck_cards` /
 * `set_deck_format` action — the latter previews the deck's unchanged cards
 * in the new format — or a `validate_deck` call with `cards`/`changes`)
 * would look like: counts,
 * legality from the rule engine, and the cards the user doesn't own enough
 * copies of. Computed when the proposal is made and stored in the action's
 * `payload.preview` — a snapshot, not re-evaluated on read.
 */
export interface AssistantDeckPreview {
  formatId: string | null
  formatName: string | null
  counts: { main: number, extra: number, side: number, total: number }
  /**
   * null when no format is in play (no legality statement). `issues` is the
   * canonical English text (what the model reads); `issueDetails` the same
   * issues as code + params, which the UI renders in the interface language
   * (missing on previews stored before #34 F2d, which show `issues`).
   */
  validation: { legal: boolean, issues: string[], issueDetails?: ValidationIssue[] } | null
  /** `nameDe` (ADR 0015) is display only and missing on previews stored before #34 F3c. */
  missing: Array<{ catalogCardId: number, name: string, nameDe?: string | null, needed: number, owned: number }>
  /**
   * The format-independent deck warnings (`buildWarnings`: usual deck sizes,
   * more than 3 copies, retired cards, #148). `warnings` is their canonical
   * English text (what the model reads); `warningDetails` the same warnings
   * as code + params, which the action card renders in the interface
   * language. Both are missing on previews stored before #148, which show
   * no warnings.
   */
  warnings?: string[]
  warningDetails?: DeckWarning[]
}

// --- Limits, shared by client-side validation and the server ------------------
// (Not part of the configurable `runtimeConfig.assistant.limits` set — see
// server/utils/assistant-limits.ts for the six operational limits that are;
// these three are validated client-side too, so they stay plain constants.)

export const ASSISTANT_MESSAGE_TEXT_MAX = 20_000
export const ASSISTANT_MESSAGE_IMAGES_MAX = 6
export const ASSISTANT_MESSAGE_TOTAL_BYTES_MAX = 12 * 1024 * 1024

// --- Tools -------------------------------------------------------------------

export const ASSISTANT_TOOL_NAMES = [
  'search_catalog',
  'get_card',
  'search_inventory',
  'list_collections',
  'list_decks',
  'get_deck',
  'list_formats',
  'validate_deck',
  'add_to_inventory',
  'create_deck',
  'update_deck_cards',
  'set_deck_format',
] as const

export type AssistantToolName = typeof ASSISTANT_TOOL_NAMES[number]

export function isAssistantToolName(value: unknown): value is AssistantToolName {
  return typeof value === 'string' && (ASSISTANT_TOOL_NAMES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** The id of the caller's deck a tool call refers to: `deckId`, or `get_deck`'s `id`. */
export function toolCallDeckId(call: Pick<AssistantToolCallView, 'name' | 'arguments'>): string | null {
  const args = call.arguments
  if (typeof args.deckId === 'string' && args.deckId !== '') {
    return args.deckId
  }
  if (call.name === 'get_deck' && typeof args.id === 'string' && args.id !== '') {
    return args.id
  }
  return null
}

/**
 * The catalog card a `get_card` call reads (#132): the result's `id` when it
 * is a positive integer, else the call's `id` argument, else null. Every
 * other tool: null.
 */
export function toolCallCardId(name: string, input: Record<string, unknown>, result?: unknown): number | null {
  if (name !== 'get_card') {
    return null
  }
  if (isRecord(result) && typeof result.id === 'number' && Number.isSafeInteger(result.id) && result.id > 0) {
    return result.id
  }
  const id = typeof input.id === 'number' || typeof input.id === 'string' ? Number(input.id) : Number.NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * What a tool activity chip names after the tool's label: the search query,
 * the proposed deck's name, the deck the call refers to (its name, #53 —
 * nothing when the name isn't known), or the card's name (from the result,
 * #128), else its id.
 */
export function toolCallDetail(call: Pick<AssistantToolCallView, 'name' | 'arguments' | 'deckName'> & { cardName?: string }): string | null {
  const args = call.arguments
  if (typeof args.query === 'string' && args.query !== '') {
    return args.query
  }
  if (typeof args.name === 'string' && args.name !== '') {
    return args.name
  }
  if (toolCallDeckId(call)) {
    return call.deckName ?? null
  }
  if (typeof args.id === 'number' || (typeof args.id === 'string' && args.id !== '')) {
    return call.cardName ?? String(args.id)
  }
  return null
}

/**
 * A tool call's outcome as the chat shows it: a result count (with
 * `truncated` when the tool capped it), a pending proposal, or the raw
 * (English) error the model got. Nothing set = done, nothing to count.
 */
export interface AssistantToolOutcome {
  count?: number
  truncated?: boolean
  pending?: boolean
  error?: string
}

/**
 * Derives the outcome from a tool result exactly as the model read it (a
 * tool part's `output.result`): the same whether the part is streaming
 * right now or was loaded with the conversation, so both look the same. Any
 * `{ error }` payload counts as failed — also the "result too large"
 * envelope of a call that itself succeeded.
 */
export function summarizeToolResult(ok: boolean, result: unknown): { ok: boolean, outcome: AssistantToolOutcome } {
  if (isRecord(result) && typeof result.error === 'string') {
    return { ok: false, outcome: { error: result.error } }
  }
  if (!ok) {
    return { ok: false, outcome: {} }
  }
  if (Array.isArray(result)) {
    return { ok: true, outcome: { count: result.length } }
  }
  // The capped read tools (server/utils/assistant-tools.ts capResult) wrap
  // their array in `{ items, truncated, total? }` so a cap isn't mistaken for
  // the true count.
  if (isRecord(result) && Array.isArray(result.items)) {
    return { ok: true, outcome: { count: result.items.length, ...(result.truncated === true ? { truncated: true } : {}) } }
  }
  if (isRecord(result) && result.status === 'pending_confirmation') {
    return { ok: true, outcome: { pending: true } }
  }
  return { ok: true, outcome: {} }
}

// --- Errors ---------------------------------------------------------------------

/**
 * `data.code` of the assistant endpoints' HTTP errors and the text of the
 * turn stream's `error` chunk; the UI shows `errors.api.<code>`.
 * `unexpected` is anything without a code of its own.
 */
export const ASSISTANT_ERROR_CODES = [
  'conversation_not_found',
  'action_not_found',
  'action_already_resolved',
  'turn_in_progress',
  'request_too_large',
  'assistant_not_configured',
  'assistant_misconfigured',
  'assistant_busy',
  'assistant_unreachable',
  'regenerate_not_allowed',
  'assistant_model_not_allowed',
  'assistant_model_unavailable',
  'unexpected',
] as const

export type AssistantErrorCode = typeof ASSISTANT_ERROR_CODES[number]
