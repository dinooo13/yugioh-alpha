// The chat assistant's message format on the AI SDK (docs/adr/0020-assistant-on-the-ai-sdk.md):
// every conversation message is an AI SDK `UIMessage` with typed parts —
// text, reasoning, one `tool-<name>` part per tool call, and two data parts
// of our own (a pending action, a stored photo placeholder). The server
// persists the parts as they are and streams them to the client with the AI
// SDK's UI message stream protocol.
//
// Type-only import from `ai`, so the UI can use these types without pulling
// the SDK's runtime into a bundle that doesn't need it.

import type { UIMessage } from 'ai'
import type { AssistantActionView, AssistantConversationSummary, AssistantToolName } from './assistant-chat'

/** Per-message metadata. Room for later additions (e.g. a per-turn context snapshot, #85). */
export interface AssistantMessageMetadata {
  createdAt?: string
  /** An answer's model id (the one the user picked, or the vision model for a turn with photos). */
  model?: string
}

/**
 * The data parts of our own, keyed by name (a part's `type` is `data-<name>`).
 * A `type` alias, not an interface: `UIMessage` requires an index signature
 * here, which an interface doesn't satisfy.
 */
export type AssistantDataParts = {
  /** A write tool's pending action (`id` = the action's id); refreshed to its current state when read. */
  action: AssistantActionView
  /** A photo the user sent with this message; the bytes are never stored (ADR 0010), only its 1-based index. */
  image: { index: number }
}

/**
 * What a tool part's `output` holds: the tool `result` exactly as the model
 * read it, plus fields the model never reads (`toModelOutput` sends only
 * `result`).
 */
export interface AssistantToolOutput {
  result: unknown
  /** Display only: the current name of the caller's deck the call refers to (#53), refreshed when read and missing when the deck is gone. */
  deckName?: string
  /**
   * Display only: the card a `get_card` call read, in both languages (#132),
   * so its chip follows the current card language. Refreshed when read,
   * missing when the card is unknown.
   */
  card?: { name: string, nameDe?: string }
  /** The proposal this write call created (#116), so the model's history can report its current status; never sent to the model. */
  actionId?: string
}

export type AssistantUITools = {
  [NAME in AssistantToolName]: { input: Record<string, unknown>, output: AssistantToolOutput }
}

export type AssistantUIMessage = UIMessage<AssistantMessageMetadata, AssistantDataParts, AssistantUITools>
export type AssistantUIMessagePart = AssistantUIMessage['parts'][number]

/** `POST /api/assistant/chat/:id/stream`'s trigger, as the AI SDK's chat transport sends it. */
export type AssistantTurnTrigger = 'submit-message' | 'regenerate-message'

/** `GET /api/assistant/chat/:id/messages`. */
export interface AssistantUIConversation {
  conversation: AssistantConversationSummary
  messages: AssistantUIMessage[]
}
