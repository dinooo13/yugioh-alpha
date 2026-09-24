// Conversations of the chat assistant (docs/adr/0010-chat-assistant-with-tools.md,
// docs/adr/0020-assistant-on-the-ai-sdk.md): creating, listing and deleting
// them, their deck link (ADR 0011) and its per-turn context block, and the
// display data of pending actions (#53, #69). The turn itself runs in
// assistant-turn.ts; the messages are read and written in
// assistant-ui-messages.ts.

import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notExists } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import { assistantConversation, assistantMessage, collection, deck } from '../db/schema'
import type { assistantAction } from '../db/schema'
import { DECK_SECTIONS } from '../../shared/deck-sections'
import { getDeckDetail, requireOwnDeck } from './decks'
import { ASSISTANT_CONVERSATION_TITLE_MAX, deckConversationTitle } from '../../shared/assistant-chat'
import type {
  AssistantActionView,
  AssistantConversationListItem,
  AssistantConversationSummary,
} from '../../shared/assistant-chat'
import { DEFAULT_APP_LOCALE } from '../../shared/locale'
import type { AppLocale } from '../../shared/locale'
import { formatDeckContextBlock, TURN_TEXT } from './assistant-prompts'

type Db = ReturnType<typeof useDb>
type ConversationRow = typeof assistantConversation.$inferSelect
type ActionRow = typeof assistantAction.$inferSelect

const CONVERSATION_LIST_MAX = 50

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function conversationNotFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Conversation not found', data: { code: 'conversation_not_found' } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// --- Validation ----------------------------------------------------------------

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

export function toConversationSummary(row: ConversationRow, deckRef: AssistantConversationSummary['deck']): AssistantConversationSummary {
  return {
    id: row.id,
    title: row.title,
    deck: deckRef,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The linked deck's id and current name, or null — the FK is `ON DELETE SET NULL`, so a deleted deck simply unlinks. */
export function loadDeckRef(db: Db, deckId: string | null): AssistantConversationSummary['deck'] {
  if (!deckId) {
    return null
  }
  const row = db.select({ id: deck.id, name: deck.name }).from(deck).where(eq(deck.id, deckId)).get()
  return row ?? null
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

export function requireOwnConversation(db: Db, userId: string, conversationId: string): ConversationRow {
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

/** The current names of the caller's own collections among `ids` (#69) — a foreign or deleted collection is simply missing. */
export function resolveCollectionNames(db: Db, userId: string, ids: Array<string | null | undefined>): Map<string, string> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))]
  if (unique.length === 0) {
    return new Map()
  }
  const rows = db
    .select({ id: collection.id, name: collection.name })
    .from(collection)
    .where(and(eq(collection.userId, userId), inArray(collection.id, unique)))
    .all()
  return new Map(rows.map(row => [row.id, row.name]))
}

function payloadCollectionIds(payload: Record<string, unknown>): string[] {
  const items = Array.isArray(payload.items) ? payload.items : []
  return items.flatMap(item => isRecord(item) && typeof item.collectionId === 'string' && item.collectionId !== '' ? [item.collectionId] : [])
}

/**
 * Action views with their display-only names resolved when read (#69), so
 * an action card never has to show a raw id: `display.deckName` for an
 * action whose payload has a `deckId` but no `deckName` (stored before the
 * payload carried it), and `display.collectionNames` for the collections
 * `add_to_inventory` items go to. `null` = gone or not the caller's. One
 * query per kind for all `rows`.
 */
export function hydrateActionViews(db: Db, userId: string, rows: ActionRow[]): AssistantActionView[] {
  const deckIdsToResolve = rows.flatMap(row =>
    typeof row.payload.deckId === 'string' && typeof row.payload.deckName !== 'string' ? [row.payload.deckId] : [])
  const deckNames = resolveDeckNames(db, userId, deckIdsToResolve)
  const collectionNames = resolveCollectionNames(db, userId, rows.flatMap(row => payloadCollectionIds(row.payload)))

  return rows.map((row) => {
    const view = toActionView(row)
    const display: NonNullable<AssistantActionView['display']> = {}
    if (typeof row.payload.deckId === 'string' && typeof row.payload.deckName !== 'string') {
      display.deckName = deckNames.get(row.payload.deckId) ?? null
    }
    const ids = payloadCollectionIds(row.payload)
    if (ids.length > 0) {
      display.collectionNames = Object.fromEntries(ids.map(id => [id, collectionNames.get(id) ?? null]))
    }
    return Object.keys(display).length > 0 ? { ...view, display } : view
  })
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

/** A conversation's title from its first user message (truncated). */
export function conversationTitleFromText(text: string): string {
  return text.length > ASSISTANT_CONVERSATION_TITLE_MAX ? `${text.slice(0, ASSISTANT_CONVERSATION_TITLE_MAX - 1)}…` : text
}

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