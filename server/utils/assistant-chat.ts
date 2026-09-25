// Conversations of the chat assistant (docs/adr/0010-chat-assistant-with-tools.md,
// docs/adr/0020-assistant-on-the-ai-sdk.md): creating, listing and deleting
// them, and the display data of pending actions and tool chips (#53, #69,
// #132). The turn itself runs in
// assistant-turn.ts; the messages are read and written in
// assistant-ui-messages.ts.

import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import { assistantConversation, collection, deck } from '../db/schema'
import type { assistantAction } from '../db/schema'
import { ASSISTANT_CONVERSATION_TITLE_MAX } from '../../shared/assistant-chat'
import type {
  AssistantActionView,
  AssistantConversationListItem,
  AssistantConversationSummary,
} from '../../shared/assistant-chat'
import { DEFAULT_APP_LOCALE } from '../../shared/locale'
import type { AppLocale } from '../../shared/locale'
import { TURN_TEXT } from './assistant-prompts'
import { loadCardNameRecords } from './deck-validation'

type Db = ReturnType<typeof useDb>
type ConversationRow = typeof assistantConversation.$inferSelect
type ActionRow = typeof assistantAction.$inferSelect

const CONVERSATION_LIST_MAX = 50

function conversationNotFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Conversation not found', data: { code: 'conversation_not_found' } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// --- Conversation CRUD -----------------------------------------------------------

export function toConversationSummary(row: ConversationRow): AssistantConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
 * Creates a plain conversation, titled with the default title in `locale`
 * (stored as is). Conversations aren't linked to decks (ADR 0021).
 */
export function createConversation(
  db: Db,
  userId: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): AssistantConversationSummary {
  const now = new Date()
  const [row] = db
    .insert(assistantConversation)
    .values({ id: randomUUID(), userId, title: TURN_TEXT[locale].defaultConversationTitle, createdAt: now, updatedAt: now })
    .returning()
    .all()
  return toConversationSummary(row!)
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

/**
 * The names of the catalog cards among `ids`, in both languages (#132; the
 * UI picks by the card language). Catalog-wide, retired cards included; an
 * unknown id is simply missing.
 */
export function resolveCardNames(db: Db, ids: Array<number | null>): Map<number, { name: string, nameDe?: string }> {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === 'number'))]
  const { cardNames, cardNamesDe } = loadCardNameRecords(db, unique)
  return new Map(unique.flatMap((id) => {
    const name = cardNames[id]
    if (name === undefined) {
      return []
    }
    const nameDe = cardNamesDe[id]
    return [[id, nameDe ? { name, nameDe } : { name }] as const]
  }))
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
