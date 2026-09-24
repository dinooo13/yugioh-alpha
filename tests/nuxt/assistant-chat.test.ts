// Conversations of the chat assistant (server/utils/assistant-chat.ts):
// CRUD, the deck link and its per-turn context block (ADR 0011), and the
// display data of proposals (#69). The turn itself is covered in
// assistant-turn.test.ts.

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  buildDeckContextBlock,
  createConversation,
  deleteConversation,
  hydrateActionViews,
  listConversations,
  loadDeckRef,
  requireOwnConversation,
  validateCreateConversationInput,
} from '../../server/utils/assistant-chat'
import { applyAction, rejectAction } from '../../server/utils/assistant-tools'
import { loadUiMessages, persistUserMessage } from '../../server/utils/assistant-ui-messages'
import { createDeck, deleteDeck, updateDeck, upsertDeckCard } from '../../server/utils/decks'
import { createRuleFormat, validateRuleFormatInput } from '../../server/utils/rule-formats'
import { readFileSync } from 'node:fs'
import { ASSISTANT_CONVERSATION_TITLE_MAX, ASSISTANT_ERROR_CODES, deckConversationTitle } from '../../shared/assistant-chat'
import { seedGermanNames } from './fixtures/german-names'

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
    expect(createConversation(db, 'user-a', {}, 'en').title).toBe('New conversation')
  })

  it('has a translation for every assistant error code (errors.api.<code>; `unexpected` has its own fallback key)', () => {
    for (const locale of ['de', 'en']) {
      const api = (JSON.parse(readFileSync(`i18n/locales/${locale}/errors.json`, 'utf8')) as { errors: { api: Record<string, string> } }).errors.api
      const missing = ASSISTANT_ERROR_CODES.filter(code => code !== 'unexpected' && !api[code])
      expect(missing, locale).toEqual([])
    }
  })
})

describe('validateCreateConversationInput (POST /api/assistant/chat body)', () => {
  it('accepts an empty body or an optional deckId', () => {
    expect(validateCreateConversationInput(undefined)).toEqual({})
    expect(validateCreateConversationInput({})).toEqual({})
    expect(validateCreateConversationInput({ deckId: null })).toEqual({})
    expect(validateCreateConversationInput({ deckId: ' deck-1 ' })).toEqual({ deckId: 'deck-1' })
  })

  it('rejects a non-object body or a non-string/empty deckId', () => {
    expect(() => validateCreateConversationInput('deck-1')).toThrowError()
    expect(() => validateCreateConversationInput(['deck-1'])).toThrowError()
    expect(() => validateCreateConversationInput({ deckId: 42 })).toThrowError()
    expect(() => validateCreateConversationInput({ deckId: '  ' })).toThrowError()
  })
})

describe('deckConversationTitle', () => {
  it('is "Deck: <name>" for a short name', () => {
    expect(deckConversationTitle('Magier')).toBe('Deck: Magier')
  })

  it('truncates to ASSISTANT_CONVERSATION_TITLE_MAX with an ellipsis', () => {
    const title = deckConversationTitle('x'.repeat(80))
    expect(title).toHaveLength(ASSISTANT_CONVERSATION_TITLE_MAX)
    expect(title.startsWith('Deck: xxx')).toBe(true)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('deck-linked conversations (ADR 0011)', () => {
  function seedDeck(userId = 'user-a', name = 'Magier-Deck') {
    const deck = createDeck(db, userId, { name, description: null })
    upsertDeckCard(db, userId, deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    return deck
  }

  it('links a new conversation to the caller\'s deck and titles it after the deck', () => {
    const deck = seedDeck()
    const conversation = createConversation(db, 'user-a', { deckId: deck.id })

    expect(conversation).toMatchObject({ title: 'Deck: Magier-Deck', deck: { id: deck.id, name: 'Magier-Deck' } })
    expect(loadDeckRef(db, requireOwnConversation(db, 'user-a', conversation.id).deckId)).toEqual({ id: deck.id, name: 'Magier-Deck' })
    // A plain conversation has no deck.
    expect(createConversation(db, 'user-a').deck).toBeNull()
  })

  it('404s for another user\'s (or an unknown) deck', () => {
    const foreign = seedDeck('user-b')
    expect(statusOf(() => createConversation(db, 'user-a', { deckId: foreign.id }))).toBe(404)
    expect(statusOf(() => createConversation(db, 'user-a', { deckId: 'does-not-exist' }))).toBe(404)
  })

  it('reuses an empty linked conversation, and starts a new one once it has messages', () => {
    const deck = seedDeck()
    const first = createConversation(db, 'user-a', { deckId: deck.id })
    expect(createConversation(db, 'user-a', { deckId: deck.id }).id).toBe(first.id)

    addUserMessage(first.id, 'Hallo')

    const second = createConversation(db, 'user-a', { deckId: deck.id })
    expect(second.id).not.toBe(first.id)
    expect(second.deck).toEqual({ id: deck.id, name: 'Magier-Deck' })
  })

  it('unlinks (deck → null) instead of deleting the conversation when the deck is deleted', () => {
    const deck = seedDeck()
    const conversation = createConversation(db, 'user-a', { deckId: deck.id })
    addUserMessage(conversation.id, 'Hallo')

    deleteDeck(db, 'user-a', deck.id)

    expect(requireOwnConversation(db, 'user-a', conversation.id).deckId).toBeNull()
    expect(loadUiMessages(db, 'user-a', conversation.id).map(message => message.role)).toEqual(['user'])
  })

  it('describes the deck\'s current state as a context block, in English (ADR 0014)', () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({
      name: 'Streng',
      rules: { rules: [{ kind: 'copies', maxCopies: 1 }] },
    }))
    const deck = seedDeck()
    updateDeck(db, 'user-a', deck.id, { formatId: format.id })

    const block = buildDeckContextBlock(db, 'user-a', deck.id, 'de')!
    expect(block).toContain(`Deck ID: ${deck.id}`)
    expect(block).toContain('Deck name: Magier-Deck')
    expect(block).toContain(`Format: Streng (ID ${format.id})`)
    expect(block).toContain('Counts: Main 2 · Extra 0 · Side 0')
    expect(block).toMatch(/Legality: not legal – Dark Magician: 2 copies in the deck; 1 copy is allowed\./)
    // German card language: a nameDe column, empty for a card without a German name.
    expect(block).toContain('Cards (catalogCardId|name|nameDe|section|quantity|owned):')
    expect(block).toContain(`${CARD.darkMagician}|Dark Magician||main|2|0`)
    expect(block).toContain(`update_deck_cards and deckId=${deck.id}`)
    expect(block).toContain('its format only with set_deck_format and this deckId')
  })

  it('rebuilds the block from the deck as it is now, e.g. after an applied change', () => {
    const deck = seedDeck()
    expect(buildDeckContextBlock(db, 'user-a', deck.id)).toContain('Legality: no format')
    expect(buildDeckContextBlock(db, 'user-a', deck.id)).not.toContain('Pot of Greed|main')

    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 })

    const block = buildDeckContextBlock(db, 'user-a', deck.id)!
    expect(block).toContain(`${CARD.potOfGreed}|Pot of Greed|main|1|0`)
    expect(block).toContain('Counts: Main 3 · Extra 0 · Side 0')
  })

  it('lists the deck\'s cards with their German names in German card language only (ADR 0015)', () => {
    seedGermanNames(db, { [CARD.darkMagician]: 'Dunkler Magier' })
    const deck = seedDeck()

    const german = buildDeckContextBlock(db, 'user-a', deck.id, 'de')!
    const english = buildDeckContextBlock(db, 'user-a', deck.id, 'en')!

    expect(german).toContain('Cards (catalogCardId|name|nameDe|section|quantity|owned):')
    expect(german).toContain(`${CARD.darkMagician}|Dark Magician|Dunkler Magier|main|2|0`)
    expect(english).toContain('Cards (catalogCardId|name|section|quantity|owned):')
    expect(english).toContain(`${CARD.darkMagician}|Dark Magician|main|2|0`)
    expect(english).not.toContain('Dunkler Magier')
  })

  it('has no block for a deleted or foreign deck', () => {
    const foreign = seedDeck('user-b')
    expect(buildDeckContextBlock(db, 'user-a', foreign.id)).toBeNull()
    expect(buildDeckContextBlock(db, 'user-a', 'does-not-exist')).toBeNull()
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
