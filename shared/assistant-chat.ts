// Shared contract for the chat assistant with tools (Phase 8), used by both
// the server (server/utils/assistant-*.ts, server/api/assistant/chat/**) and
// the UI. Intentionally dependency-free beyond other pure shared modules, so
// the UI can import types without pulling in server code. See
// docs/adr/0010-chat-assistant-with-tools.md and
// docs/adr/0011-deck-assistance-in-chat.md.

/** `GET /api/assistant/status` — whether (and how) the assistant is configured on this server. */
export interface AssistantStatus {
  enabled: boolean
  provider: 'openai' | 'fake' | null
  model: string | null
  /** For provider 'openai': the endpoint's host (never a key). */
  baseUrl?: string | null
  /** Whether the chat assistant (`/assistant`) is usable — same as `enabled`. */
  chat: boolean
  /** Whether chat turns may include images — true whenever the assistant is enabled. */
  vision: boolean
  /** The model used for image-containing chat turns when a vision model is configured; null = falls back to `model`. */
  visionModel: string | null
}

export type AssistantMessageRole = 'user' | 'assistant' | 'tool'

export interface AssistantAttachment {
  kind: 'image'
  /** e.g. "Foto 1" — the image bytes themselves are never persisted. */
  label: string
}

/** A tool call as persisted/rendered — arguments already parsed to an object. */
export interface AssistantToolCallView {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface AssistantMessageView {
  id: string
  role: AssistantMessageRole
  content: string
  toolCalls?: AssistantToolCallView[]
  toolCallId?: string
  toolName?: string
  attachments?: AssistantAttachment[]
  createdAt: string
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
}

export interface AssistantConversationListItem {
  id: string
  title: string
  updatedAt: string
}

/** The deck a conversation is linked to (ADR 0011); null once the deck is deleted. */
export interface AssistantConversationDeckRef {
  id: string
  name: string
}

/** Max length of a conversation title (server-side truncation and the default deck title). */
export const ASSISTANT_CONVERSATION_TITLE_MAX = 80

/**
 * The default title of a deck-linked conversation ("Deck: <name>"), truncated
 * to `ASSISTANT_CONVERSATION_TITLE_MAX` like every other title. The thread
 * page compares against it to tell whether the title still just repeats the
 * deck chip (#48).
 */
export function deckConversationTitle(deckName: string): string {
  const title = `Deck: ${deckName}`
  return title.length > ASSISTANT_CONVERSATION_TITLE_MAX
    ? `${title.slice(0, ASSISTANT_CONVERSATION_TITLE_MAX - 1)}…`
    : title
}

export interface AssistantConversationSummary {
  id: string
  title: string
  deck: AssistantConversationDeckRef | null
  createdAt: string
  updatedAt: string
}

export interface AssistantConversationDetail {
  conversation: AssistantConversationSummary
  messages: AssistantMessageView[]
  actions: AssistantActionView[]
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
  /** null when no format is in play (no legality statement). */
  validation: { legal: boolean, issues: string[] } | null
  missing: Array<{ catalogCardId: number, name: string, needed: number, owned: number }>
}

// --- Limits, shared by client-side validation and the server ------------------
// (Not part of the configurable `runtimeConfig.assistant.limits` set — see
// server/utils/assistant-limits.ts for the six operational limits that are;
// these three are validated client-side too, so they stay plain constants.)

export const ASSISTANT_MESSAGE_TEXT_MAX = 20_000
export const ASSISTANT_MESSAGE_IMAGES_MAX = 6
export const ASSISTANT_MESSAGE_TOTAL_BYTES_MAX = 12 * 1024 * 1024

// --- SSE event payloads for POST /api/assistant/chat/:id/messages ------------

export interface AssistantSseMessageStart { userMessageId: string }
export interface AssistantSseTextDelta { text: string }
export interface AssistantSseToolCall { id: string, name: string, label: string }
export interface AssistantSseToolResult { id: string, ok: boolean, summary: string }
export interface AssistantSseActionProposed { action: AssistantActionView }
export interface AssistantSseMessageEnd { message: AssistantMessageView }
export interface AssistantSseError { message: string }

// --- German labels, per tool name, for chat activity chips --------------------
// (server/utils/assistant-chat.ts builds the full "Sucht im Katalog: X…"
// activity label off this; the UI's ToolActivity.vue reuses it verbatim.)

export const ASSISTANT_TOOL_LABELS: Record<string, string> = {
  search_catalog: 'Sucht im Katalog',
  get_card: 'Liest Kartendetails',
  search_inventory: 'Durchsucht dein Inventar',
  list_collections: 'Listet deine Sammlungen',
  list_decks: 'Listet deine Decks',
  get_deck: 'Liest ein Deck',
  list_formats: 'Listet Formate',
  validate_deck: 'Prüft ein Deck',
  add_to_inventory: 'Schlägt vor, Karten ins Inventar aufzunehmen',
  create_deck: 'Schlägt ein neues Deck vor',
  update_deck_cards: 'Schlägt Deck-Änderungen vor',
  set_deck_format: 'Schlägt eine Formatänderung vor',
}

export const ASSISTANT_ACTION_KIND_LABELS: Record<AssistantActionKind, string> = {
  add_to_inventory: 'Karten ins Inventar aufnehmen',
  create_deck: 'Neues Deck anlegen',
  update_deck_cards: 'Deck-Karten ändern',
  set_deck_format: 'Deck-Format ändern',
}

export const ASSISTANT_ACTION_STATUS_LABELS: Record<AssistantActionStatus, string> = {
  pending: 'Wartet auf Bestätigung',
  applied: 'Übernommen',
  rejected: 'Verworfen',
  failed: 'Fehlgeschlagen',
}
