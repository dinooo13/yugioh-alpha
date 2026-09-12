// Shared contract for the chat assistant with tools (Phase 8), used by both
// the server (server/utils/assistant-*.ts, server/api/assistant/chat/**) and
// the UI. Intentionally dependency-free beyond other pure shared modules, so
// the UI can import types without pulling in server code. See
// docs/adr/0010-chat-assistant-with-tools.md.

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

export type AssistantActionKind = 'add_to_inventory' | 'create_deck' | 'update_deck_cards'
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

export interface AssistantConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface AssistantConversationDetail {
  conversation: AssistantConversationSummary
  messages: AssistantMessageView[]
  actions: AssistantActionView[]
}

// --- Limits, shared by client-side validation and the server ------------------

export const ASSISTANT_MESSAGE_TEXT_MAX = 4000
export const ASSISTANT_MESSAGE_IMAGES_MAX = 3
export const ASSISTANT_MESSAGE_TOTAL_BYTES_MAX = 4 * 1024 * 1024
export const ASSISTANT_MAX_TOOL_ROUNDS = 8

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
}

export const ASSISTANT_ACTION_KIND_LABELS: Record<AssistantActionKind, string> = {
  add_to_inventory: 'Karten ins Inventar aufnehmen',
  create_deck: 'Neues Deck anlegen',
  update_deck_cards: 'Deck-Karten ändern',
}

export const ASSISTANT_ACTION_STATUS_LABELS: Record<AssistantActionStatus, string> = {
  pending: 'Wartet auf Bestätigung',
  applied: 'Übernommen',
  rejected: 'Verworfen',
  failed: 'Fehlgeschlagen',
}
