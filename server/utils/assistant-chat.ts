// The chat engine for the chat assistant (Phase 8, see
// docs/adr/0010-chat-assistant-with-tools.md): conversation/message
// persistence, the tool-calling loop that drives `DeckAssistantModel.chat`,
// and the events the streaming endpoint relays to the client as SSE.
//
// The server never trusts the model here either (same posture as the deck
// assistant, ADR 0006): every tool call is validated by `runTool`
// (assistant-tools.ts) before it touches the database, and a write tool
// never mutates directly — it only ever produces a pending `assistantAction`.

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, notExists } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import { assistantAction, assistantConversation, assistantMessage, deck } from '../db/schema'
import { DECK_SECTIONS } from '../../shared/deck-sections'
import { getDeckDetail, requireOwnDeck } from './decks'
import type {
  ChatMessage,
  ChatModelInput,
  DeckAssistantModel,
} from './deck-assistant-model'
import { runTool, toolDefinitions } from './assistant-tools'
import type { AssistantProposedAction } from './assistant-tools'
import { getAssistantLimits } from './assistant-limits'
import type { AssistantLimits } from './assistant-limits'
import {
  ASSISTANT_MESSAGE_IMAGES_MAX,
  ASSISTANT_MESSAGE_TEXT_MAX,
  ASSISTANT_MESSAGE_TOTAL_BYTES_MAX,
  ASSISTANT_CONVERSATION_TITLE_MAX,
  deckConversationTitle,
  summarizeToolResult,
  toolCallDeckId,
} from '../../shared/assistant-chat'
import type {
  AssistantActionView,
  AssistantConversationDetail,
  AssistantConversationListItem,
  AssistantConversationSummary,
  AssistantMessageView,
  AssistantToolCallView,
  AssistantToolOutcome,
} from '../../shared/assistant-chat'
import { DEFAULT_APP_LOCALE } from '../../shared/locale'
import type { AppLocale } from '../../shared/locale'
import { buildSystemPrompt, formatDeckContextBlock, TOOL_TEXT, TURN_TEXT } from './assistant-prompts'

type Db = ReturnType<typeof useDb>
type ConversationRow = typeof assistantConversation.$inferSelect
type MessageRow = typeof assistantMessage.$inferSelect
type ActionRow = typeof assistantAction.$inferSelect

const CONVERSATION_TITLE_MAX_LENGTH = ASSISTANT_CONVERSATION_TITLE_MAX
const CONVERSATION_LIST_MAX = 50

// The model sees at most `limits.historyMessages` prior messages, oldest
// dropped first once `limits.historyChars` is exceeded — see docs/adr/0010's
// "History" decision. Every tool result the model sees is independently
// capped at `limits.toolResultChars`, on top of each read tool's own item
// cap (assistant-tools.ts), so one oversized result can't blow up the
// history budget. Both, plus the tool-round cap below, come from
// `getAssistantLimits()` (server/utils/assistant-limits.ts) — configurable
// via `runtimeConfig.assistant.limits` / `NUXT_ASSISTANT_LIMITS_*`.

const TURN_TIMEOUT_MS = 5 * 60 * 1000

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function conversationNotFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Conversation not found', data: { code: 'conversation_not_found' } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** An error's technical (English) `statusMessage` — what the model reads as a tool error, and the SSE `error` event's `message`. */
function errorStatusMessage(error: unknown): string {
  if (isRecord(error) && typeof error.statusMessage === 'string' && error.statusMessage !== '') {
    return error.statusMessage
  }
  return TOOL_TEXT.unexpectedError
}

/** An error's `data.code` for the SSE `error` event (ADR 0014: the UI translates it), else `unexpected`. */
function errorCode(error: unknown): string {
  const data = isRecord(error) && isRecord(error.data) ? error.data : undefined
  return typeof data?.code === 'string' && data.code !== '' ? data.code : 'unexpected'
}

// --- Validation ----------------------------------------------------------------

export interface AssistantMessageInput {
  text: string
  images: string[]
}

// Only the three MIME types the client actually produces (see ADR 0010's
// "Images (client)" decision — canvas-resized JPEG, or a passthrough
// PNG/WebP) are accepted; anything else (e.g. `data:text/html`,
// `data:application/pdf`) is rejected rather than forwarded to the model.
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:jpe?g|png|webp)[;,]/i

/** The decoded byte size of a `data:` URL's base64 payload (3/4 of its encoded character length, ignoring padding). */
function decodedByteSizeOfDataUrl(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  const base64Length = commaIndex >= 0 ? dataUrl.length - commaIndex - 1 : dataUrl.length
  const paddingLength = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64Length * 3) / 4) - paddingLength)
}

export function validateAssistantMessageInput(body: unknown): AssistantMessageInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const rawText = body.text
  if (rawText !== undefined && typeof rawText !== 'string') {
    badRequest('text must be a string')
  }
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (text.length > ASSISTANT_MESSAGE_TEXT_MAX) {
    badRequest(`text must be at most ${ASSISTANT_MESSAGE_TEXT_MAX} characters`)
  }

  const rawImages = body.images
  const images: string[] = []
  if (rawImages !== undefined) {
    if (!Array.isArray(rawImages)) {
      badRequest('images must be an array')
    }
    if (rawImages.length > ASSISTANT_MESSAGE_IMAGES_MAX) {
      badRequest(`images must contain at most ${ASSISTANT_MESSAGE_IMAGES_MAX} entries`)
    }
    for (const image of rawImages) {
      if (typeof image !== 'string' || !IMAGE_DATA_URL_PATTERN.test(image)) {
        badRequest('images must be data URLs with an image/jpeg, image/png or image/webp MIME type')
      }
      images.push(image)
    }
    // The data URL's base64 payload decodes to 3/4 of its character length —
    // measuring the raw string length instead would let ~1/3 more decoded
    // bytes through than the cap intends.
    const totalBytes = images.reduce((sum, image) => sum + decodedByteSizeOfDataUrl(image), 0)
    if (totalBytes > ASSISTANT_MESSAGE_TOTAL_BYTES_MAX) {
      badRequest('images are too large in total')
    }
  }

  if (text === '' && images.length === 0) {
    badRequest('text or images is required')
  }

  return { text, images }
}

export interface CreateConversationInput {
  /** Links the new conversation to one of the caller's decks (ADR 0011). */
  deckId?: string
}

/** `POST /api/assistant/chat`'s optional body — an empty body is a plain, unlinked conversation. */
export function validateCreateConversationInput(body: unknown): CreateConversationInput {
  if (body === undefined || body === null || body === '') {
    return {}
  }
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const rawDeckId = body.deckId
  if (rawDeckId === undefined || rawDeckId === null) {
    return {}
  }
  if (typeof rawDeckId !== 'string' || rawDeckId.trim() === '') {
    badRequest('deckId must be a non-empty string')
  }
  return { deckId: rawDeckId.trim() }
}

// --- Conversation CRUD -----------------------------------------------------------

function toConversationSummary(row: ConversationRow, deckRef: AssistantConversationSummary['deck']): AssistantConversationSummary {
  return {
    id: row.id,
    title: row.title,
    deck: deckRef,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The linked deck's id and current name, or null — the FK is `ON DELETE SET NULL`, so a deleted deck simply unlinks. */
function loadDeckRef(db: Db, deckId: string | null): AssistantConversationSummary['deck'] {
  if (!deckId) {
    return null
  }
  const row = db.select({ id: deck.id, name: deck.name }).from(deck).where(eq(deck.id, deckId)).get()
  return row ?? null
}

export function toMessageView(row: MessageRow): AssistantMessageView {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    ...(row.toolCalls ? { toolCalls: row.toolCalls } : {}),
    ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
    ...(row.toolName ? { toolName: row.toolName } : {}),
    ...(row.attachments ? { attachments: row.attachments } : {}),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toActionView(row: ActionRow): AssistantActionView {
  return {
    id: row.id,
    messageId: row.messageId,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload,
    status: row.status,
    ...(row.result !== null && row.result !== undefined ? { result: row.result } : {}),
  }
}

/**
 * Creates a conversation, optionally linked to one of the caller's decks
 * (404 for a foreign/unknown deck). A deck-linked conversation is titled
 * "Deck: <name>" and — so that clicking "Mit KI bearbeiten" twice doesn't
 * pile up empty threads — an existing linked conversation that has no
 * messages yet is returned instead of creating another one. An unlinked
 * conversation starts with the default title in `locale` (stored as is).
 */
export function createConversation(
  db: Db,
  userId: string,
  input: CreateConversationInput = {},
  locale: AppLocale = DEFAULT_APP_LOCALE,
): AssistantConversationSummary {
  const now = new Date()

  if (input.deckId) {
    const deckRow = requireOwnDeck(db, userId, input.deckId)
    const deckRef = { id: deckRow.id, name: deckRow.name }

    const emptyLinked = db
      .select()
      .from(assistantConversation)
      .where(and(
        eq(assistantConversation.userId, userId),
        eq(assistantConversation.deckId, deckRow.id),
        notExists(db
          .select({ id: assistantMessage.id })
          .from(assistantMessage)
          .where(eq(assistantMessage.conversationId, assistantConversation.id))),
      ))
      .orderBy(desc(assistantConversation.updatedAt))
      .limit(1)
      .get()
    if (emptyLinked) {
      return toConversationSummary(emptyLinked, deckRef)
    }

    const [row] = db
      .insert(assistantConversation)
      .values({
        id: randomUUID(),
        userId,
        title: deckConversationTitle(deckRow.name),
        deckId: deckRow.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()
    return toConversationSummary(row!, deckRef)
  }

  const [row] = db
    .insert(assistantConversation)
    .values({ id: randomUUID(), userId, title: TURN_TEXT[locale].defaultConversationTitle, createdAt: now, updatedAt: now })
    .returning()
    .all()
  return toConversationSummary(row!, null)
}

export function listConversations(db: Db, userId: string): AssistantConversationListItem[] {
  const rows = db
    .select()
    .from(assistantConversation)
    .where(eq(assistantConversation.userId, userId))
    .orderBy(desc(assistantConversation.updatedAt))
    .limit(CONVERSATION_LIST_MAX)
    .all()

  return rows.map(row => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() }))
}

function requireOwnConversation(db: Db, userId: string, conversationId: string): ConversationRow {
  const row = db
    .select()
    .from(assistantConversation)
    .where(and(eq(assistantConversation.id, conversationId), eq(assistantConversation.userId, userId)))
    .get()

  if (!row) {
    conversationNotFound()
  }
  return row
}

export function getConversationDetail(db: Db, userId: string, conversationId: string): AssistantConversationDetail {
  const conversation = requireOwnConversation(db, userId, conversationId)

  const messages = db
    .select()
    .from(assistantMessage)
    .where(eq(assistantMessage.conversationId, conversationId))
    .orderBy(asc(assistantMessage.createdAt))
    .all()

  const actions = db
    .select()
    .from(assistantAction)
    .where(eq(assistantAction.conversationId, conversationId))
    .orderBy(asc(assistantAction.createdAt))
    .all()

  const views = messages.map(toMessageView)
  const deckNames = resolveDeckNames(db, userId, views.flatMap(view => (view.toolCalls ?? []).map(toolCallDeckId)))

  return {
    conversation: toConversationSummary(conversation, loadDeckRef(db, conversation.deckId)),
    messages: views.map(view => view.toolCalls
      ? { ...view, toolCalls: view.toolCalls.map(call => withDeckName(call, deckNames)) }
      : view),
    actions: actions.map(toActionView),
  }
}

/** The current names of the caller's own decks among `ids` (#53) — a foreign or deleted deck is simply missing. */
export function resolveDeckNames(db: Db, userId: string, ids: Array<string | null>): Map<string, string> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))]
  if (unique.length === 0) {
    return new Map()
  }
  const rows = db
    .select({ id: deck.id, name: deck.name })
    .from(deck)
    .where(and(eq(deck.userId, userId), inArray(deck.id, unique)))
    .all()
  return new Map(rows.map(row => [row.id, row.name]))
}

/** Adds the display-only `deckName` (#53) to a tool call that refers to one of the caller's decks. */
function withDeckName<T extends Pick<AssistantToolCallView, 'name' | 'arguments'>>(call: T, deckNames: Map<string, string>): T & { deckName?: string } {
  const deckId = toolCallDeckId(call)
  const deckName = deckId ? deckNames.get(deckId) : undefined
  return deckName !== undefined ? { ...call, deckName } : call
}

export function deleteConversation(db: Db, userId: string, conversationId: string): void {
  const deleted = db
    .delete(assistantConversation)
    .where(and(eq(assistantConversation.id, conversationId), eq(assistantConversation.userId, userId)))
    .returning({ id: assistantConversation.id })
    .all()

  if (deleted.length === 0) {
    conversationNotFound()
  }
}

// --- History -----------------------------------------------------------------

/**
 * Fixes up a trimmed history window so it never starts or ends mid
 * tool-call sequence — a plain count/char trim can cut the window right
 * between an assistant `tool_calls` message and its `tool` result rows (or
 * leave a `tool_calls` message whose results were never persisted, e.g. the
 * turn died between the assistant insert and a tool insert). Sent as-is to
 * an OpenAI-compatible endpoint, either shape is rejected with 400
 * ("'messages' with role 'tool' must be a response to a preceding message
 * with 'tool_calls'"), permanently breaking every further turn in that
 * conversation.
 *
 * Rules (order matters — user rows are never dropped, so the loop below
 * always leaves the window starting on a `user` row once one exists):
 * 1. Drop leading rows until the first row is a `user` message.
 * 2. Drop an assistant `tool_calls` message unless every one of its
 *    `toolCalls[].id` has a matching `tool` row in the window.
 * 3. Drop a `tool` row whose `toolCallId` has no preceding (kept) assistant
 *    `tool_calls` message in the window.
 */
function sanitizeHistoryWindow(rows: MessageRow[]): MessageRow[] {
  let start = 0
  while (start < rows.length && rows[start]!.role !== 'user') {
    start += 1
  }
  const windowed = rows.slice(start)

  const toolCallIdsWithResult = new Set(
    windowed.filter(row => row.role === 'tool' && row.toolCallId).map(row => row.toolCallId!),
  )

  const sanitized: MessageRow[] = []
  const answeredCallIds = new Set<string>()

  for (const row of windowed) {
    if (row.role === 'assistant' && row.toolCalls && row.toolCalls.length > 0) {
      const allAnswered = row.toolCalls.every(call => toolCallIdsWithResult.has(call.id))
      if (!allAnswered) {
        continue
      }
      for (const call of row.toolCalls) {
        answeredCallIds.add(call.id)
      }
      sanitized.push(row)
    }
    else if (row.role === 'tool') {
      if (row.toolCallId && answeredCallIds.has(row.toolCallId)) {
        sanitized.push(row)
      }
      // else: orphan tool row (its assistant tool_calls message isn't in
      // the window) — dropped.
    }
    else {
      sanitized.push(row)
    }
  }

  return sanitized
}

function loadHistory(db: Db, conversationId: string, limits: AssistantLimits): MessageRow[] {
  const rows = db
    .select()
    .from(assistantMessage)
    .where(eq(assistantMessage.conversationId, conversationId))
    .orderBy(desc(assistantMessage.createdAt))
    .limit(limits.historyMessages)
    .all()

  const oldestFirst = rows.reverse()

  let totalChars = oldestFirst.reduce((sum, row) => sum + row.content.length, 0)
  const trimmed = [...oldestFirst]
  while (totalChars > limits.historyChars && trimmed.length > 1) {
    const removed = trimmed.shift()!
    totalChars -= removed.content.length
  }
  return sanitizeHistoryWindow(trimmed)
}

function toHistoryChatMessage(row: MessageRow): ChatMessage {
  if (row.role === 'user') {
    return { role: 'user', content: [{ type: 'text', text: row.content }] }
  }
  if (row.role === 'assistant') {
    return {
      role: 'assistant',
      content: row.content !== '' ? row.content : null,
      ...(row.toolCalls && row.toolCalls.length > 0
        ? {
            tool_calls: row.toolCalls.map(call => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          }
        : {}),
    }
  }
  return { role: 'tool', tool_call_id: row.toolCallId ?? '', content: row.content }
}

// --- Tool results --------------------------------------------------------------

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// A result over budget is replaced with a small, valid JSON envelope instead
// of being cut off mid-string — a truncated JSON document is not just
// unreadable for a human, it's not parseable at all, so a model asked to
// reason about "the tool result" gets a syntax-broken blob instead of data.
function serializeToolResult(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value ?? null)
  if (json.length <= maxChars) {
    return json
  }
  return JSON.stringify(TOOL_TEXT.resultTooLarge)
}

/** Parses a tool call's accumulated `arguments` JSON, or reports that it failed to parse at all (see the caller: invalid JSON is a tool error, not silently `{}`). */
function tryParseToolArguments(argumentsJson: string): { ok: true, value: unknown } | { ok: false } {
  if (argumentsJson.trim() === '') {
    return { ok: true, value: {} }
  }
  try {
    return { ok: true, value: JSON.parse(argumentsJson) }
  }
  catch {
    return { ok: false }
  }
}

/** Used only to persist an assistant message's `toolCalls` field, which always wants an object — falls back to `{}` for storage/display even when `tryParseToolArguments` above would treat the same string as a tool error. */
function safeParseToolArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = argumentsJson.trim() === '' ? {} : JSON.parse(argumentsJson)
    return isRecord(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

// --- Persistence helpers -------------------------------------------------------

interface InsertMessageFields {
  role: MessageRow['role']
  content: string
  toolCalls?: MessageRow['toolCalls']
  toolCallId?: string
  toolName?: string
  attachments?: MessageRow['attachments']
}

/**
 * Persists one message and bumps the conversation's `updatedAt` in the same
 * call — every message that lands in the conversation (user, assistant
 * tool-call round, tool result, final answer) should move it in the
 * conversation list, not just a turn that happens to finish successfully.
 */
function insertMessage(
  db: Db,
  conversationId: string,
  fields: InsertMessageFields,
): MessageRow {
  const now = new Date()
  const [row] = db
    .insert(assistantMessage)
    .values({
      id: randomUUID(),
      conversationId,
      toolCalls: null,
      toolCallId: null,
      toolName: null,
      attachments: null,
      createdAt: now,
      ...fields,
    })
    .returning()
    .all()
  db.update(assistantConversation).set({ updatedAt: now }).where(eq(assistantConversation.id, conversationId)).run()
  return row!
}

// --- Streaming events ----------------------------------------------------------

export type ChatTurnEvent =
  | { type: 'message_start', userMessageId: string }
  | { type: 'text_delta', text: string }
  | { type: 'tool_call', id: string, name: string, arguments: Record<string, unknown>, deckName?: string }
  | { type: 'tool_result', id: string, ok: boolean, outcome: AssistantToolOutcome }
  | { type: 'action_proposed', action: AssistantActionView }
  | { type: 'message_end', message: AssistantMessageView }
  | { type: 'error', code: string, message: string }

// --- Deck context (ADR 0011) ------------------------------------------------------

/**
 * The linked deck's *current* state as a system-prompt block, rebuilt from
 * `getDeckDetail` at the start of every turn and never persisted — so an
 * applied change (or a manual edit in the deck editor) shows up on the very
 * next turn without anything in the history going stale. `null` when the
 * deck is gone. The deck name and card names are user data inside the
 * system prompt, so the block marks them as data, not instructions; the
 * free-text deck description is left out entirely. The text itself lives in
 * assistant-prompts.ts (`formatDeckContextBlock`).
 */
export function buildDeckContextBlock(db: Db, userId: string, deckId: string, cardLocale: AppLocale = 'en'): string | null {
  let detail: ReturnType<typeof getDeckDetail>
  try {
    detail = getDeckDetail(db, userId, deckId)
  }
  catch {
    return null
  }

  const withGermanNames = cardLocale === 'de'
  return formatDeckContextBlock({
    id: detail.id,
    name: detail.name,
    format: detail.format ? { id: detail.format.id, name: detail.format.name } : null,
    counts: detail.counts,
    validation: detail.validation
      ? { legal: detail.validation.legal, issueMessages: detail.validation.issues.map(issue => issue.message) }
      : null,
    cardLines: DECK_SECTIONS.flatMap(section => detail.sections[section].map(row =>
      withGermanNames
        ? `${row.catalogCardId}|${row.name}|${row.nameDe ?? ''}|${section}|${row.quantity}|${row.owned}`
        : `${row.catalogCardId}|${row.name}|${section}|${row.quantity}|${row.owned}`)),
    withGermanNames,
  })
}

// --- The turn loop ---------------------------------------------------------------

/**
 * Runs one user turn to completion: persists the user message, drives the
 * model through up to `getAssistantLimits().maxToolRounds` tool-calling
 * rounds (each tool call validated and executed via `runTool`, a write tool's outcome
 * persisted as a pending `assistantAction`), and persists/emits the final
 * assistant answer. Never throws: any failure is reported as an `error`
 * event, with nothing further persisted.
 *
 * `signal`, when given (the messages endpoint ties it to the SSE
 * connection's close/abort — an explicit "Abbrechen"), stops the loop
 * between rounds and mid-round once the model call itself reports
 * `aborted`; either way, whatever text was produced so far is still
 * persisted as the final assistant message, marked "… (abgebrochen)".
 *
 * `input.locale` is the interface language of the request (the messages
 * endpoint resolves it per turn): the reply-language instruction at the end
 * of the system prompt and the fallback texts saved as the answer follow it.
 * `input.cardLocale` is the card language (ADR 0015): the card-name
 * instruction, the deck context block and the tool results follow it.
 */
export async function runChatTurn(
  db: Db,
  userId: string,
  conversationId: string,
  input: AssistantMessageInput & { locale?: AppLocale, cardLocale?: AppLocale },
  model: DeckAssistantModel,
  emit: (event: ChatTurnEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const locale = input.locale ?? DEFAULT_APP_LOCALE
  const cardLocale = input.cardLocale ?? locale
  const turnText = TURN_TEXT[locale]
  const conversation = requireOwnConversation(db, userId, conversationId)
  const deckContext = conversation.deckId ? buildDeckContextBlock(db, userId, conversation.deckId, cardLocale) : null

  const limits = getAssistantLimits()
  const priorHistory = loadHistory(db, conversationId, limits)
  const isFirstMessage = priorHistory.length === 0

  const attachments = input.images.map((_, index) => ({ kind: 'image' as const, label: turnText.photoLabel(index + 1) }))
  const userMessage = insertMessage(db, conversationId, {
    role: 'user',
    content: input.text,
    attachments: attachments.length > 0 ? attachments : null,
  })
  // The title is derived from the first user message the moment it's
  // persisted — not after a successful turn completes. A turn that fails
  // right after this (provider down, 502) must not leave the conversation
  // titled "Neue Unterhaltung" forever, and a *later* turn can no longer
  // derive it at all (`isFirstMessage` is only true once). A deck-linked
  // conversation keeps its "Deck: <name>" title.
  if (isFirstMessage && input.text !== '' && !conversation.deckId) {
    db.update(assistantConversation)
      .set({ title: truncate(input.text, CONVERSATION_TITLE_MAX_LENGTH) })
      .where(eq(assistantConversation.id, conversationId))
      .run()
  }
  await emit({ type: 'message_start', userMessageId: userMessage.id })

  const messages: ChatMessage[] = [
    ...priorHistory.map(toHistoryChatMessage),
    {
      role: 'user',
      content: [
        ...(input.text !== '' ? [{ type: 'text' as const, text: input.text }] : []),
        ...input.images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
      ],
    },
  ]

  const system = buildSystemPrompt({ deckContext, hasImages: input.images.length > 0, locale, cardLocale })
  const startedAt = Date.now()

  try {
    let finalText: string | null = null
    let aborted = false

    for (let round = 0; round < limits.maxToolRounds; round++) {
      if (signal?.aborted) {
        aborted = true
        break
      }
      if (Date.now() - startedAt > TURN_TIMEOUT_MS) {
        finalText = turnText.timeout
        break
      }

      const modelInput: ChatModelInput = {
        sessionId: conversationId,
        system,
        messages,
        tools: toolDefinitions(),
      }

      const result = await model.chat(modelInput, {
        onTextDelta: text => emit({ type: 'text_delta', text }),
      }, signal)

      if (result.aborted) {
        finalText = result.text
        aborted = true
        break
      }

      // A `length` finish means the model's output (answer or tool-call
      // arguments) was cut off by a context/output cap — never trustworthy
      // enough to feed into another round, so the turn ends here regardless
      // of whether this round also carries (now possibly truncated) tool
      // calls.
      if (result.finishReason === 'length') {
        const base = result.text !== '' ? result.text : turnText.cutOffFallback
        finalText = `${base} ${turnText.cutOffSuffix}`
        break
      }

      if (result.toolCalls.length === 0) {
        finalText = result.finishReason === 'content_filter' || result.text === ''
          ? turnText.noAnswer
          : result.text
        break
      }

      const storedToolCalls = result.toolCalls.map(call => ({
        id: call.id,
        name: call.name,
        arguments: safeParseToolArguments(call.arguments),
      }))
      const assistantRow = insertMessage(db, conversationId, {
        role: 'assistant',
        content: result.text,
        toolCalls: storedToolCalls,
      })

      messages.push({
        role: 'assistant',
        content: result.text !== '' ? result.text : null,
        tool_calls: result.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      })

      const deckNames = resolveDeckNames(db, userId, storedToolCalls.map(toolCallDeckId))

      for (const [index, call] of result.toolCalls.entries()) {
        // Structured, like the persisted call: the UI builds the chip's text
        // in the interface language (ADR 0014), with the deck's name instead
        // of its id (#53).
        const { name, arguments: parsedForDisplay, deckName } = withDeckName(storedToolCalls[index]!, deckNames)
        await emit({ type: 'tool_call', id: call.id, name, arguments: parsedForDisplay, ...(deckName !== undefined ? { deckName } : {}) })

        let ok = true
        let resultForModel: unknown
        let proposedAction: AssistantProposedAction | undefined

        const parsedArguments = tryParseToolArguments(call.arguments)
        if (!parsedArguments.ok) {
          // A `length` finish (or any other truncation) can leave the
          // accumulated `arguments` string as cut-off JSON. Running the tool
          // with `{}` would silently fail on missing required fields in a way
          // the model can't tell apart from a genuine argument mistake — an
          // explicit error lets it retry with a shorter/different call.
          ok = false
          resultForModel = { error: TOOL_TEXT.invalidArguments }
        }
        else {
          try {
            const outcome = await runTool(call.name, { db, userId, cardLocale }, parsedArguments.value)
            resultForModel = outcome.result
            if ('action' in outcome) {
              proposedAction = outcome.action
            }
          }
          catch (error) {
            ok = false
            resultForModel = { error: errorStatusMessage(error) }
          }
        }

        const toolContent = serializeToolResult(resultForModel, limits.toolResultChars)
        insertMessage(db, conversationId, {
          role: 'tool',
          content: toolContent,
          toolCallId: call.id,
          toolName: call.name,
        })
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent })

        // Summarized from `toolContent` — exactly what got persisted — not
        // the pre-serialization `resultForModel`: a result too large to
        // store is replaced by `serializeToolResult` with a small `{ error }`
        // envelope, and the live chip must report the same outcome a reload
        // will later derive from that same JSON (the UI runs the same
        // `summarizeToolResult` from shared/assistant-chat.ts on it).
        const summarized = summarizeToolResult(ok, JSON.parse(toolContent))
        await emit({ type: 'tool_result', id: call.id, ok: summarized.ok, outcome: summarized.outcome })

        if (proposedAction) {
          const now = new Date()
          const [actionRow] = db
            .insert(assistantAction)
            .values({
              id: randomUUID(),
              conversationId,
              messageId: assistantRow.id,
              userId,
              kind: proposedAction.kind,
              payload: proposedAction.payload,
              summary: proposedAction.summary,
              status: 'pending',
              createdAt: now,
            })
            .returning()
            .all()
          await emit({ type: 'action_proposed', action: toActionView(actionRow!) })
        }
      }
    }

    if (aborted) {
      // Persist whatever the model produced before the "Abbrechen" landed
      // (possibly nothing) instead of losing it — clearly marked so it
      // isn't mistaken for a complete answer.
      const partial = (finalText ?? '').trim()
      finalText = partial !== '' ? `${partial} ${turnText.cancelledSuffix}` : turnText.cancelledSuffix
    }
    else if (finalText === null) {
      // Exhausted every round without a final answer — every one of the 8
      // rounds requested another tool call.
      finalText = turnText.tooManySteps
    }
    // `insertMessage` bumps `updatedAt`; the title was already derived (if
    // applicable) right after the user message was persisted, above.
    const finalMessage = insertMessage(db, conversationId, { role: 'assistant', content: finalText })

    await emit({ type: 'message_end', message: toMessageView(finalMessage) })
  }
  catch (error) {
    await emit({ type: 'error', code: errorCode(error), message: errorStatusMessage(error) })
  }
}
