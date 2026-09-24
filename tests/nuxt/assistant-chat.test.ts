// Conversations of the chat assistant (server/utils/assistant-chat.ts):
// CRUD, no deck link (ADR 0021), and the display data of proposals (#69). The turn itself is covered in
// assistant-turn.test.ts.

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  createConversation,
  deleteConversation,
  hydrateActionViews,
  listConversations,
  requireOwnConversation,
} from '../../server/utils/assistant-chat'
import { applyAction, rejectAction } from '../../server/utils/assistant-tools'
import { loadUiMessages, persistUserMessage } from '../../server/utils/assistant-ui-messages'
import { createDeck, deleteDeck, upsertDeckCard } from '../../server/utils/decks'
import { readFileSync } from 'node:fs'
import { ASSISTANT_ERROR_CODES } from '../../shared/assistant-chat'

const CARD = {
  darkMagician: 46986414,
  potOfGreed: 55144522,
} as const

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

function seedUsersAndCatalog(db: TestDb) {
  const now = new Date()
  db.insert(schema.user).values([
    { id: 'user-a', name: 'User A', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'User B', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()

  db.insert(schema.catalogCard).values([
    { id: CARD.darkMagician, name: 'Dark Magician', type: 'Normal Monster', desc: 'The ultimate wizard.', syncedAt: now },
    { id: CARD.potOfGreed, name: 'Pot of Greed', type: 'Spell Card', desc: 'Draw two cards.', syncedAt: now },
  ]).run()
}

/** The HTTP status a thrown error carries, or undefined if nothing was thrown. */
function statusOf(run: () => unknown): number | undefined {
  try {
    run()
  }
  catch (error) {
    return (error as { statusCode?: number }).statusCode
  }
  return undefined
}

function addUserMessage(conversationId: string, text: string) {
  return persistUserMessage(db, { conversationId, id: crypto.randomUUID(), text, imageCount: 0 })
}

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  seedUsersAndCatalog(db)
})

describe('conversation CRUD', () => {
  it('creates, lists, reads, and deletes a conversation, all scoped to the owner', () => {
    const conversation = createConversation(db, 'user-a')
    expect(conversation.title).toBe('Neue Unterhaltung')

    expect(listConversations(db, 'user-a')).toEqual([
      { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt },
    ])
    expect(listConversations(db, 'user-b')).toEqual([])

    expect(requireOwnConversation(db, 'user-a', conversation.id).id).toBe(conversation.id)
    expect(loadUiMessages(db, 'user-a', conversation.id)).toEqual([])

    expect(statusOf(() => requireOwnConversation(db, 'user-b', conversation.id))).toBe(404)
    expect(statusOf(() => deleteConversation(db, 'user-b', conversation.id))).toBe(404)

    deleteConversation(db, 'user-a', conversation.id)
    expect(statusOf(() => requireOwnConversation(db, 'user-a', conversation.id))).toBe(404)
  })

  it('titles a new conversation in the given locale (German by default)', () => {
    expect(createConversation(db, 'user-a').title).toBe('Neue Unterhaltung')
    expect(createConversation(db, 'user-a', 'en').title).toBe('New conversation')
  })

  it('has a translation for every assistant error code (errors.api.<code>; `unexpected` has its own fallback key)', () => {
    for (const locale of ['de', 'en']) {
      const api = (JSON.parse(readFileSync(`i18n/locales/${locale}/errors.json`, 'utf8')) as { errors: { api: Record<string, string> } }).errors.api
      const missing = ASSISTANT_ERROR_CODES.filter(code => code !== 'unexpected' && !api[code])
      expect(missing, locale).toEqual([])
    }
  })
})

describe('no deck link (ADR 0021)', () => {
  it('always creates a new, plain conversation — no deck in the summary, no reuse of an empty one', () => {
    const first = createConversation(db, 'user-a')
    const second = createConversation(db, 'user-a')

    expect(second.id).not.toBe(first.id)
    expect([first.title, second.title]).toEqual(['Neue Unterhaltung', 'Neue Unterhaltung'])
    expect(Object.keys(first).sort()).toEqual(['createdAt', 'id', 'title', 'updatedAt'])
    expect(requireOwnConversation(db, 'user-a', first.id).deckId).toBeNull()
  })

  it('keeps a legacy deck-linked conversation, its messages and its title when the deck is deleted (deck_id → null)', () => {
    const deck = createDeck(db, 'user-a', { name: 'Magier-Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    const conversation = createConversation(db, 'user-a')
    db.update(schema.assistantConversation)
      .set({ deckId: deck.id, title: 'Deck: Magier-Deck' })
      .where(eq(schema.assistantConversation.id, conversation.id))
      .run()
    addUserMessage(conversation.id, 'Hallo')

    deleteDeck(db, 'user-a', deck.id)

    const row = requireOwnConversation(db, 'user-a', conversation.id)
    expect(row.deckId).toBeNull()
    expect(row.title).toBe('Deck: Magier-Deck')
    expect(loadUiMessages(db, 'user-a', conversation.id).map(message => message.role)).toEqual(['user'])
  })
})

describe('hydrateActionViews (#69)', () => {
  function seedAction(id: string, kind: 'add_to_inventory' | 'update_deck_cards' | 'set_deck_format', payload: Record<string, unknown>) {
    const conversation = createConversation(db, 'user-a')
    const now = new Date()
    db.insert(schema.assistantMessage).values({ id: `msg-${id}`, conversationId: conversation.id, role: 'assistant', content: '', createdAt: now }).run()
    db.insert(schema.assistantAction).values({ id, conversationId: conversation.id, messageId: `msg-${id}`, userId: 'user-a', kind, payload, summary: 's', status: 'pending', createdAt: now }).run()
    return db.select().from(schema.assistantAction).where(eq(schema.assistantAction.id, id)).get()!
  }

  it('names the deck of an old action without a stored deckName, and each target collection — never a raw id', () => {
    const deck = createDeck(db, 'user-a', { name: 'Magier-Deck', description: null })
    const foreignDeck = createDeck(db, 'user-b', { name: 'Fremd', description: null })
    db.insert(schema.collection).values({ id: 'col-a', userId: 'user-a', name: 'Ordner 1', createdAt: new Date(), updatedAt: new Date() }).run()

    const views = hydrateActionViews(db, 'user-a', [
      seedAction('old', 'update_deck_cards', { deckId: deck.id, changes: [] }),
      seedAction('foreign', 'set_deck_format', { deckId: foreignDeck.id, formatId: null }),
      seedAction('inventory', 'add_to_inventory', { items: [{ catalogCardId: CARD.darkMagician, quantity: 1, collectionId: 'col-a' }, { catalogCardId: CARD.potOfGreed, quantity: 1, collectionId: 'col-gone' }] }),
      seedAction('plain', 'add_to_inventory', { items: [{ catalogCardId: CARD.darkMagician, quantity: 1 }] }),
    ])

    expect(views.map(view => view.display)).toEqual([
      { deckName: 'Magier-Deck' },
      { deckName: null },
      { collectionNames: { 'col-a': 'Ordner 1', 'col-gone': null } },
      undefined,
    ])
  })

  it('comes back from apply and reject with the resolved names', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Magier-Deck', description: null })
    const rejected = rejectAction(db, 'user-a', seedAction('r', 'set_deck_format', { deckId: deck.id, formatId: null }).id)
    expect(hydrateActionViews(db, 'user-a', [rejected])[0]).toMatchObject({ status: 'rejected', display: { deckName: 'Magier-Deck' } })

    const applied = await applyAction(db, 'user-a', seedAction('a', 'add_to_inventory', { items: [{ catalogCardId: CARD.darkMagician, quantity: 1 }] }).id)
    expect(hydrateActionViews(db, 'user-a', [applied])[0]).toMatchObject({ status: 'applied' })
  })
})
