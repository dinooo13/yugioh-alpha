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
  toolCallCardId,
  toolCallDeckId,
} from '../../shared/assistant-chat'
import type { AssistantActionKind, AssistantActionStatus, AssistantActionView } from '../../shared/assistant-chat'
import type { AssistantToolOutput, AssistantTurnTrigger, AssistantUIMessage, AssistantUIMessagePart } from '../../shared/assistant-ui'
import { hydrateActionViews, resolveCardNames, resolveDeckNames, toActionView } from './assistant-chat'
import { TOOL_TEXT } from './assistant-prompts'

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

/**
 * Answers stored before the turn stopped streaming `tool-input-error`
 * chunks keep an invalid call's input in the AI SDK's deprecated `rawInput`
 * field, which the SDK warns about whenever such a message is read. Moves
 * it to `input`, where the SDK expects it now.
 */
function withoutRawInput(parts: AssistantUIMessagePart[]): AssistantUIMessagePart[] {
  return parts.map((part) => {
    if (!isToolPart(part) || !('rawInput' in part)) {
      return part
    }
    const { rawInput, ...rest } = part as typeof part & { rawInput?: unknown }
    return { ...rest, input: rest.input ?? rawInput } as AssistantUIMessagePart
  })
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
        parts: withoutRawInput(row.parts),
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

/** The tool name and input of a tool part. */
function toolPartCall(part: Extract<AssistantUIMessagePart, { toolCallId: string }>): { name: string, arguments: Record<string, unknown> } {
  return { name: part.type.slice('tool-'.length), arguments: isRecord(part.input) ? part.input : {} }
}

/** The catalog card a finished `get_card` part read (#132), else null. */
function toolPartCardId(part: AssistantUIMessagePart): number | null {
  if (!isToolPart(part) || part.state !== 'output-available') {
    return null
  }
  const call = toolPartCall(part)
  return toolCallCardId(call.name, call.arguments, isRecord(part.output) ? part.output.result : undefined)
}

/**
 * Refreshes display data in stored parts: every `data-action` part gets its
 * action's current view (status, #69 names) and is dropped when the action
 * is gone; a tool part's `output.deckName` becomes the current name of the
 * caller's deck it refers to (#53), and is removed when that deck is gone;
 * a `get_card` part's `output.card` becomes the card's names in both
 * languages (#132), so its chip follows the current card language, and is
 * removed when the card is unknown.
 */
export function hydrateUiParts(
  parts: AssistantUIMessagePart[],
  actionViews: Map<string, AssistantActionView>,
  deckNames: Map<string, string>,
  cardNames: Map<number, { name: string, nameDe?: string }> = new Map(),
): AssistantUIMessagePart[] {
  return parts.flatMap((part): AssistantUIMessagePart[] => {
    if (part.type === 'data-action') {
      const view = actionViews.get(part.id ?? part.data.id)
      return view ? [{ ...part, id: view.id, data: view }] : []
    }
    if (isToolPart(part) && part.state === 'output-available' && isRecord(part.output)) {
      const deckId = toolCallDeckId(toolPartCall(part))
      const cardId = toolPartCardId(part)
      const { deckName: _staleDeck, card: _staleCard, ...output } = part.output as AssistantToolOutput
      const deckName = deckId ? deckNames.get(deckId) : undefined
      const card = cardId !== null ? cardNames.get(cardId) : undefined
      return [{
        ...part,
        output: { ...output, ...(deckName !== undefined ? { deckName } : {}), ...(card ? { card } : {}) },
      } as AssistantUIMessagePart]
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
  const parts = messages.flatMap(message => message.parts)
  const deckNames = resolveDeckNames(db, userId, parts.flatMap(part => isToolPart(part) ? [toolCallDeckId(toolPartCall(part))] : []))
  const cardNames = resolveCardNames(db, parts.map(toolPartCardId))

  return messages
    // A turn still running has an empty answer until its first step ends.
    .filter(message => message.role !== 'assistant' || !isEmptyAssistantParts(message.parts))
    .map(message => ({ ...message, parts: hydrateUiParts(message.parts, viewsById, deckNames, cardNames) }))
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

const WRITE_TOOL_KINDS: readonly AssistantActionKind[] = ['add_to_inventory', 'create_deck', 'update_deck_cards', 'set_deck_format']

function isWriteToolKind(name: string): name is AssistantActionKind {
  return (WRITE_TOOL_KINDS as readonly string[]).includes(name)
}

/**
 * The model's view of each proposal's current status (#116). A write tool's
 * stored result always says `pending_confirmation`; once the user applied or
 * rejected the proposal (or applying it failed), the result becomes
 * `{ ...result, status, message }` with the `TOOL_TEXT.proposalStatus` text,
 * plus `failureReason` for a failed one (not `error`, which would make the
 * call itself look failed). A write call finds its action by
 * `output.actionId` (turns since #116), else among the actions of the
 * message's `data-action` parts, in order: the first unused one of the same
 * kind with the same summary, else the first unused one of the same kind.
 * Pure: returns new objects and never touches what is stored.
 */
export function withProposalStatus(messages: AssistantUIMessage[], actions: ActionRow[]): AssistantUIMessage[] {
  const actionsById = new Map(actions.map(action => [action.id, action]))
  return messages.map((message) => {
    const candidates = message.parts.flatMap((part) => {
      const action = part.type === 'data-action' ? actionsById.get(part.id ?? part.data.id) : undefined
      return action ? [action] : []
    })
    const used = new Set<string>()
    let changed = false
    const parts = message.parts.map((part): AssistantUIMessagePart => {
      if (!isToolPart(part) || part.state !== 'output-available' || !isRecord(part.output)) {
        return part
      }
      const kind = toolPartCall(part).name
      const output = part.output as AssistantToolOutput
      const result = output.result
      if (!isWriteToolKind(kind) || !isRecord(result) || result.status !== 'pending_confirmation') {
        return part
      }
      const unused = candidates.filter(candidate => !used.has(candidate.id) && candidate.kind === kind)
      const action = typeof output.actionId === 'string'
        ? actionsById.get(output.actionId)
        : unused.find(candidate => candidate.summary === result.summary) ?? unused[0]
      if (!action) {
        return part
      }
      used.add(action.id)
      if (action.status === 'pending') {
        return part
      }
      const status: Exclude<AssistantActionStatus, 'pending'> = action.status
      const failureReason = status === 'failed' && isRecord(action.result) && typeof action.result.error === 'string'
        ? { failureReason: action.result.error }
        : {}
      changed = true
      return {
        ...part,
        output: { ...output, result: { ...result, status, message: TOOL_TEXT.proposalStatus[status], ...failureReason } },
      } as AssistantUIMessagePart
    })
    return changed ? { ...message, parts } : message
  })
}

/**
 * The model's history: every message, converted and trimmed. Not hydrated
 * for display (the model never reads display data), but proposals carry
 * their current status (#116, `withProposalStatus`). Legacy answers get
 * their `data-action` parts for that; `convertToModelMessages` leaves them
 * out like every data part.
 */
export function loadUiHistory(db: Db, conversationId: string, limits: { historyMessages: number, historyChars: number }): AssistantUIMessage[] {
  const actionRows: ActionRow[] = db
    .select()
    .from(assistantAction)
    .where(eq(assistantAction.conversationId, conversationId))
    .orderBy(asc(assistantAction.createdAt))
    .all()
  const viewsByMessage = new Map<string, AssistantActionView[]>()
  for (const row of actionRows) {
    viewsByMessage.set(row.messageId, [...(viewsByMessage.get(row.messageId) ?? []), toActionView(row)])
  }
  const messages = legacyRowsToUIMessages(loadRows(db, conversationId), viewsByMessage)
  return trimUiHistory(withProposalStatus(messages, actionRows), limits)
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
 * photo — the image bytes are never stored (ADR 0010). The legacy
 * `attachments` column stays empty (the parts carry the photos). Bumps the
 * conversation's `updatedAt`.
 */
export function persistUserMessage(
  db: Db,
  fields: { conversationId: string, id: string, text: string, imageCount: number, now?: Date },
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
 * Timestamped after `after` so the thread order is unambiguous. `model`
 * (the model id that answers) is kept in the message's metadata.
 */
export function insertAssistantPlaceholder(db: Db, fields: { conversationId: string, id: string, after: Date, model?: string }): MessageRow {
  const createdAt = new Date(Math.max(Date.now(), fields.after.getTime() + 1))
  const [row] = db
    .insert(assistantMessage)
    .values({
      id: fields.id,
      conversationId: fields.conversationId,
      role: 'assistant',
      content: '',
      parts: [],
      metadata: fields.model ? { model: fields.model } : null,
      createdAt,
    })
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
  /** The model the user picked; checked against the configured list by the endpoint. Missing = the default model. */
  model?: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Only the three MIME types the client actually produces (see ADR 0010's
// "Images (client)" decision — canvas-resized JPEG, or a passthrough
// PNG/WebP) are accepted; anything else (e.g. `data:text/html`,
// `data:application/pdf`) is rejected rather than forwarded to the model.
export const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:jpe?g|png|webp)[;,]/i

/** The decoded byte size of a `data:` URL's base64 payload (3/4 of its encoded character length, ignoring padding). */
export function decodedByteSizeOfDataUrl(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  const base64Length = commaIndex >= 0 ? dataUrl.length - commaIndex - 1 : dataUrl.length
  const paddingLength = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64Length * 3) / 4) - paddingLength)
}

/**
 * Validates a turn request as the AI SDK's chat transport sends it (only the
 * newest message; the server reads the history from the database and never
 * trusts client history): `{ trigger, message }`, where a submitted message
 * is a user UIMessage of text and `file` parts. The limits: text ≤ 20,000
 * characters, ≤ 6 images, jpeg/png/webp data URLs, ≤ 12 MB decoded in
 * total (the decoded size, not the data URL's length). Nothing of the
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
  if (body.model !== undefined && body.model !== null && (typeof body.model !== 'string' || body.model.trim() === '')) {
    badRequest('model must be a non-empty string')
  }
  const model = typeof body.model === 'string' ? { model: body.model.trim() } : {}
  if (trigger === 'regenerate-message') {
    return { trigger, text: '', images: [], ...model }
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
  return { trigger, ...(clientMessageId ? { clientMessageId } : {}), text, images, ...model }
}

/** A new message id: the client's when it is a free UUID, else a server one. */
export function chooseUserMessageId(db: Db, clientMessageId: string | undefined): string {
  return clientMessageId && isMessageIdFree(db, clientMessageId) ? clientMessageId : randomUUID()
}
