// Conversation messages as AI SDK UIMessages (docs/adr/0020-assistant-on-the-ai-sdk.md):
// reading them (including the rows of the former engine, converted when read
// and never rewritten), hydrating them for display, trimming the model's
// history window, persisting a turn's messages, and validating a turn
// request.
//
// Storage: one `assistant_message` row per UIMessage, its parts in the
// `parts` JSON column and its joined text in `content`. A row with `parts`
// NULL is a legacy row: the former engine stored one row per model round
// plus one 'tool' row per tool result (ADR 0010).

import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import { assistantAction, assistantConversation, assistantMessage } from '../db/schema'
import {
  ASSISTANT_MESSAGE_IMAGES_MAX,
  ASSISTANT_MESSAGE_TEXT_MAX,
  ASSISTANT_MESSAGE_TOTAL_BYTES_MAX,
  toolCallDeckId,
} from '../../shared/assistant-chat'
import type { AssistantActionView } from '../../shared/assistant-chat'
import type { AssistantTurnTrigger, AssistantUIMessage, AssistantUIMessagePart } from '../../shared/assistant-ui'
import type { AppLocale } from '../../shared/locale'
import { decodedByteSizeOfDataUrl, hydrateActionViews, IMAGE_DATA_URL_PATTERN, resolveDeckNames } from './assistant-chat'
import { TOOL_TEXT, TURN_TEXT } from './assistant-prompts'

type Db = ReturnType<typeof useDb>
type MessageRow = typeof assistantMessage.$inferSelect
type ActionRow = typeof assistantAction.$inferSelect

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

/** A tool part as built here (the SDK's type is keyed by our tool names; legacy rows may name any tool). */
function toolPart(fields: {
  name: string
  toolCallId: string
  input: Record<string, unknown>
} & ({ result: unknown } | { errorText: string })): AssistantUIMessagePart {
  const base = { type: `tool-${fields.name}`, toolCallId: fields.toolCallId, input: fields.input }
  return ('errorText' in fields
    ? { ...base, state: 'output-error', errorText: fields.errorText }
    : { ...base, state: 'output-available', output: { result: fields.result } }) as AssistantUIMessagePart
}

function isToolPart(part: AssistantUIMessagePart): part is Extract<AssistantUIMessagePart, { toolCallId: string }> & { type: `tool-${string}` } {
  return part.type.startsWith('tool-')
}

/** The joined text of a message's text parts — stored as `content` (title, legacy readers). */
export function uiMessageText(parts: AssistantUIMessagePart[]): string {
  return parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n')
}

// --- Legacy rows ------------------------------------------------------------------

/**
 * Converts stored rows (oldest first) into UIMessages. A new-format row is
 * one message as stored. Legacy rows are regrouped the way the thread
 * showed them:
 * - a user row is a `user` message: its text, plus a `data-image` part per
 *   stored photo;
 * - the assistant and tool rows up to the next user (or new-format) row are
 *   one `assistant` message, id = its first assistant row. Per assistant row
 *   (one model round): a `step-start` part (so `convertToModelMessages`
 *   splits the rounds), its text, one tool part per requested call —
 *   `output-available` with the stored result, or `output-error` when the
 *   result is `{ error }` or its tool row is missing — and then a
 *   `data-action` part per action proposed in that round.
 * Tool rows without their call are dropped.
 */
export function legacyRowsToUIMessages(rows: MessageRow[], actionsByMessageId: Map<string, AssistantActionView[]>): AssistantUIMessage[] {
  const messages: AssistantUIMessage[] = []
  let group: MessageRow[] = []

  const flushGroup = () => {
    const assistantRows = group.filter(row => row.role === 'assistant')
    if (assistantRows.length > 0) {
      const toolRows = new Map(group.filter(row => row.role === 'tool' && row.toolCallId).map(row => [row.toolCallId!, row]))
      const parts: AssistantUIMessagePart[] = []
      for (const row of assistantRows) {
        parts.push({ type: 'step-start' })
        if (row.content !== '') {
          parts.push({ type: 'text', text: row.content, state: 'done' })
        }
        for (const call of row.toolCalls ?? []) {
          parts.push(legacyToolPart(call, toolRows.get(call.id)))
        }
        for (const action of actionsByMessageId.get(row.id) ?? []) {
          parts.push({ type: 'data-action', id: action.id, data: action })
        }
      }
      messages.push({
        id: assistantRows[0]!.id,
        role: 'assistant',
        parts,
        metadata: { createdAt: assistantRows[0]!.createdAt.toISOString() },
      })
    }
    group = []
  }

  for (const row of rows) {
    if (row.parts) {
      flushGroup()
      messages.push({
        id: row.id,
        role: row.role === 'user' ? 'user' : 'assistant',
        parts: row.parts,
        metadata: { ...row.metadata, createdAt: row.createdAt.toISOString() },
      })
    }
    else if (row.role === 'user') {
      flushGroup()
      messages.push({
        id: row.id,
        role: 'user',
        parts: [
          ...(row.content !== '' ? [{ type: 'text' as const, text: row.content }] : []),
          ...(row.attachments ?? []).map((_, index) => ({ type: 'data-image' as const, data: { index: index + 1 } })),
        ],
        metadata: { createdAt: row.createdAt.toISOString() },
      })
    }
    else {
      group.push(row)
    }
  }
  flushGroup()
  return messages
}

function legacyToolPart(call: { id: string, name: string, arguments: Record<string, unknown> }, toolRow: MessageRow | undefined): AssistantUIMessagePart {
  const fields = { name: call.name, toolCallId: call.id, input: call.arguments }
  if (!toolRow) {
    return toolPart({ ...fields, errorText: TOOL_TEXT.missingResult })
  }
  let result: unknown
  try {
    result = JSON.parse(toolRow.content)
  }
  catch {
    result = toolRow.content
  }
  if (isRecord(result) && typeof result.error === 'string') {
    return toolPart({ ...fields, errorText: result.error })
  }
  return toolPart({ ...fields, result })
}

// --- Reading --------------------------------------------------------------------

function loadRows(db: Db, conversationId: string): MessageRow[] {
  return db
    .select()
    .from(assistantMessage)
    .where(eq(assistantMessage.conversationId, conversationId))
    .orderBy(asc(assistantMessage.createdAt), sql`rowid`)
    .all()
}

/**
 * Refreshes display data in stored parts: every `data-action` part gets its
 * action's current view (status, #69 names) and is dropped when the action
 * is gone; a tool part's `output.deckName` becomes the current name of the
 * caller's deck it refers to (#53), and is removed when that deck is gone.
 */
export function hydrateUiParts(
  parts: AssistantUIMessagePart[],
  actionViews: Map<string, AssistantActionView>,
  deckNames: Map<string, string>,
): AssistantUIMessagePart[] {
  return parts.flatMap((part): AssistantUIMessagePart[] => {
    if (part.type === 'data-action') {
      const view = actionViews.get(part.id ?? part.data.id)
      return view ? [{ ...part, id: view.id, data: view }] : []
    }
    if (isToolPart(part) && part.state === 'output-available' && isRecord(part.output)) {
      const deckId = toolCallDeckId({ name: part.type.slice('tool-'.length), arguments: isRecord(part.input) ? part.input : {} })
      const { deckName: _stale, ...output } = part.output as { deckName?: string, result: unknown }
      const deckName = deckId ? deckNames.get(deckId) : undefined
      return [{ ...part, output: deckName !== undefined ? { ...output, deckName } : output } as AssistantUIMessagePart]
    }
    return [part]
  })
}

/** Every message of a conversation (the caller checks ownership) as UIMessages, hydrated for display; the still-empty answer of a running turn is left out. */
export function loadUiMessages(db: Db, userId: string, conversationId: string): AssistantUIMessage[] {
  const rows = loadRows(db, conversationId)
  const actionRows: ActionRow[] = db
    .select()
    .from(assistantAction)
    .where(and(eq(assistantAction.conversationId, conversationId), eq(assistantAction.userId, userId)))
    .orderBy(asc(assistantAction.createdAt))
    .all()

  const views = hydrateActionViews(db, userId, actionRows)
  const viewsById = new Map(views.map(view => [view.id, view]))
  const viewsByMessage = new Map<string, AssistantActionView[]>()
  for (const view of views) {
    viewsByMessage.set(view.messageId, [...(viewsByMessage.get(view.messageId) ?? []), view])
  }

  const messages = legacyRowsToUIMessages(rows, viewsByMessage)
  const deckIds = messages.flatMap(message => message.parts.flatMap(part =>
    isToolPart(part) ? [toolCallDeckId({ name: part.type.slice('tool-'.length), arguments: isRecord(part.input) ? part.input : {} })] : []))
  const deckNames = resolveDeckNames(db, userId, deckIds)

  return messages
    // A turn still running has an empty answer until its first step ends.
    .filter(message => message.role !== 'assistant' || !isEmptyAssistantParts(message.parts))
    .map(message => ({ ...message, parts: hydrateUiParts(message.parts, viewsById, deckNames) }))
}

/** What a message costs in the model's history budget: its parts minus those the model never reads (data parts, reasoning). */
function historySize(message: AssistantUIMessage): number {
  return JSON.stringify(message.parts.filter(part => !part.type.startsWith('data-') && part.type !== 'reasoning')).length
}

/**
 * The model's history window (docs/adr/0010 "History"): the last
 * `historyMessages` messages, oldest dropped first while their size exceeds
 * `historyChars` (the last message always stays), starting at a user
 * message.
 */
export function trimUiHistory(messages: AssistantUIMessage[], limits: { historyMessages: number, historyChars: number }): AssistantUIMessage[] {
  const window = messages.slice(-limits.historyMessages)
  const sizes = window.map(historySize)
  let total = sizes.reduce((sum, size) => sum + size, 0)
  let start = 0
  while (total > limits.historyChars && window.length - start > 1) {
    total -= sizes[start]!
    start += 1
  }
  const trimmed = window.slice(start)
  const firstUser = trimmed.findIndex(message => message.role === 'user')
  return firstUser >= 0 ? trimmed.slice(firstUser) : []
}

/** The model's history (not hydrated: the model never reads display data): every message, converted and trimmed. */
export function loadUiHistory(db: Db, conversationId: string, limits: { historyMessages: number, historyChars: number }): AssistantUIMessage[] {
  return trimUiHistory(legacyRowsToUIMessages(loadRows(db, conversationId), new Map()), limits)
}

// --- Writing --------------------------------------------------------------------

function bumpConversation(db: Db, conversationId: string, now: Date): void {
  db.update(assistantConversation).set({ updatedAt: now }).where(eq(assistantConversation.id, conversationId)).run()
}

/** Whether a message id is free to use for a new row. */
export function isMessageIdFree(db: Db, id: string): boolean {
  return !db.select({ id: assistantMessage.id }).from(assistantMessage).where(eq(assistantMessage.id, id)).get()
}

/**
 * Stores the user's message: its text and one `data-image` placeholder per
 * photo — the image bytes are never stored (ADR 0010). `attachments` keeps
 * the labels for the former engine's thread, which still reads these rows.
 * Bumps the conversation's `updatedAt`.
 */
export function persistUserMessage(
  db: Db,
  fields: { conversationId: string, id: string, text: string, imageCount: number, locale: AppLocale, now?: Date },
): MessageRow {
  const now = fields.now ?? new Date()
  const images = Array.from({ length: fields.imageCount }, (_, index) => index + 1)
  const parts: AssistantUIMessagePart[] = [
    ...(fields.text !== '' ? [{ type: 'text' as const, text: fields.text }] : []),
    ...images.map(index => ({ type: 'data-image' as const, data: { index } })),
  ]
  const [row] = db
    .insert(assistantMessage)
    .values({
      id: fields.id,
      conversationId: fields.conversationId,
      role: 'user',
      content: fields.text,
      attachments: images.length > 0 ? images.map(index => ({ kind: 'image' as const, label: TURN_TEXT[fields.locale].photoLabel(index) })) : null,
      parts,
      createdAt: now,
    })
    .returning()
    .all()
  bumpConversation(db, fields.conversationId, now)
  return row!
}

/**
 * Inserts the (still empty) assistant message a turn streams into, before
 * the model runs: its id is the UIMessage id the client sees, and a write
 * tool's `assistant_action.message_id` references it (the FK is enforced).
 * Timestamped after `after` so the thread order is unambiguous.
 */
export function insertAssistantPlaceholder(db: Db, fields: { conversationId: string, id: string, after: Date }): MessageRow {
  const createdAt = new Date(Math.max(Date.now(), fields.after.getTime() + 1))
  const [row] = db
    .insert(assistantMessage)
    .values({ id: fields.id, conversationId: fields.conversationId, role: 'assistant', content: '', parts: [], createdAt })
    .returning()
    .all()
  return row!
}

/** Stores an assistant message's current parts (after every step, and at the end of the turn). */
export function updateAssistantMessage(db: Db, id: string, parts: AssistantUIMessagePart[]): void {
  db.update(assistantMessage).set({ parts, content: uiMessageText(parts) }).where(eq(assistantMessage.id, id)).run()
}

export function deleteAssistantMessage(db: Db, id: string): void {
  db.delete(assistantMessage).where(eq(assistantMessage.id, id)).run()
}

/** Whether a message has nothing worth keeping (no parts beyond step boundaries). */
export function isEmptyAssistantParts(parts: AssistantUIMessagePart[]): boolean {
  return parts.every(part => part.type === 'step-start')
}

export function touchConversation(db: Db, conversationId: string): void {
  bumpConversation(db, conversationId, new Date())
}

/**
 * For "regenerate": deletes everything after the conversation's last user
 * message — the answer to regenerate (legacy rows included) — together with
 * its proposals, but only while every one of them is still pending; once
 * one was applied or rejected, the answer stays (409
 * `regenerate_not_allowed`). Nothing after the last user message (a turn
 * that failed) is fine: the turn simply runs again. Returns the last user
 * message's row.
 */
export function deleteRegeneratableTail(db: Db, conversationId: string): MessageRow {
  const rows = loadRows(db, conversationId)
  let lastUserIndex = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.role === 'user') {
      lastUserIndex = i
      break
    }
  }
  if (lastUserIndex < 0) {
    badRequest('There is no message to regenerate an answer for')
  }
  const tail = rows.slice(lastUserIndex + 1)
  if (tail.length > 0) {
    const tailIds = new Set(tail.map(row => row.id))
    const actions = db
      .select({ messageId: assistantAction.messageId, status: assistantAction.status })
      .from(assistantAction)
      .where(eq(assistantAction.conversationId, conversationId))
      .all()
      .filter(action => tailIds.has(action.messageId))
    if (actions.some(action => action.status !== 'pending')) {
      throw createError({ statusCode: 409, statusMessage: 'This answer can no longer be regenerated', data: { code: 'regenerate_not_allowed' } })
    }
    // Pending actions go with their messages (ON DELETE CASCADE).
    for (const row of tail) {
      db.delete(assistantMessage).where(eq(assistantMessage.id, row.id)).run()
    }
  }
  return rows[lastUserIndex]!
}

// --- Validation -------------------------------------------------------------------

export interface AssistantTurnImage {
  mediaType: string
  /** A `data:` URL (jpeg/png/webp). */
  url: string
}

export interface AssistantTurnRequest {
  trigger: AssistantTurnTrigger
  /** The client's id for the new user message (used when it is a free UUID). */
  clientMessageId?: string
  /** submit: the message's trimmed text ('' when it only carries photos). */
  text: string
  /** submit: the photos, sent to the model in this turn only. */
  images: AssistantTurnImage[]
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates a turn request as the AI SDK's chat transport sends it (only the
 * newest message; the server reads the history from the database and never
 * trusts client history): `{ trigger, message }`, where a submitted message
 * is a user UIMessage of text and `file` parts. The limits are those of the
 * former `validateAssistantMessageInput`: text ≤ 20,000 characters, ≤ 6
 * images, jpeg/png/webp data URLs, ≤ 12 MB decoded in total. Nothing of the
 * client's JSON is passed on; the turn builds its own message from the
 * result.
 */
export function validateAssistantTurnRequest(body: unknown): AssistantTurnRequest {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }
  const trigger = body.trigger ?? 'submit-message'
  if (trigger !== 'submit-message' && trigger !== 'regenerate-message') {
    badRequest('trigger must be "submit-message" or "regenerate-message"')
  }
  if (trigger === 'regenerate-message') {
    return { trigger, text: '', images: [] }
  }

  const message = body.message
  if (!isRecord(message)) {
    badRequest('message must be an object')
  }
  if (message.role !== 'user') {
    badRequest('message.role must be "user"')
  }
  if (!Array.isArray(message.parts)) {
    badRequest('message.parts must be an array')
  }

  const texts: string[] = []
  const images: AssistantTurnImage[] = []
  for (const part of message.parts) {
    if (!isRecord(part)) {
      badRequest('message.parts must contain objects')
    }
    if (part.type === 'text') {
      if (typeof part.text !== 'string') {
        badRequest('A text part needs a string text')
      }
      texts.push(part.text)
    }
    else if (part.type === 'file') {
      if (typeof part.url !== 'string' || !IMAGE_DATA_URL_PATTERN.test(part.url)) {
        badRequest('images must be data URLs with an image/jpeg, image/png or image/webp MIME type')
      }
      const mediaType = typeof part.mediaType === 'string' && /^image\/(?:jpe?g|png|webp)$/i.test(part.mediaType)
        ? part.mediaType.toLowerCase()
        : part.url.slice('data:'.length, part.url.search(/[;,]/)).toLowerCase()
      images.push({ mediaType, url: part.url })
    }
    else {
      badRequest('message.parts may only contain text and file parts')
    }
  }

  const text = texts.join('\n\n').trim()
  if (text.length > ASSISTANT_MESSAGE_TEXT_MAX) {
    badRequest(`text must be at most ${ASSISTANT_MESSAGE_TEXT_MAX} characters`)
  }
  if (images.length > ASSISTANT_MESSAGE_IMAGES_MAX) {
    badRequest(`images must contain at most ${ASSISTANT_MESSAGE_IMAGES_MAX} entries`)
  }
  const totalBytes = images.reduce((sum, image) => sum + decodedByteSizeOfDataUrl(image.url), 0)
  if (totalBytes > ASSISTANT_MESSAGE_TOTAL_BYTES_MAX) {
    badRequest('images are too large in total')
  }
  if (text === '' && images.length === 0) {
    badRequest('text or images is required')
  }

  const clientMessageId = typeof message.id === 'string' && UUID_PATTERN.test(message.id) ? message.id : undefined
  return { trigger, ...(clientMessageId ? { clientMessageId } : {}), text, images }
}

/** A new message id: the client's when it is a free UUID, else a server one. */
export function chooseUserMessageId(db: Db, clientMessageId: string | undefined): string {
  return clientMessageId && isMessageIdFree(db, clientMessageId) ? clientMessageId : randomUUID()
}
