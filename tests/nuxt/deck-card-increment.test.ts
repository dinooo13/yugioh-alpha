// The increment mode of `PUT /api/decks/:id/cards` (#148): the catalog's
// "Zum Deck" adds a copy in one step instead of reading the deck first.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  createDeck,
  getDeckDetail,
  incrementDeckCard,
  MAX_DECK_CARD_QUANTITY,
  upsertDeckCard,
  validateDeckCardIncrementInput,
} from '../../server/utils/decks'

const DARK_MAGICIAN = 46986414
const STARDUST_DRAGON = 44508094

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

function seed(db: TestDb) {
  const now = new Date()
  db.insert(schema.user).values([
    { id: 'user-a', name: 'User A', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'User B', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()
  db.insert(schema.catalogCard).values([
    { id: DARK_MAGICIAN, name: 'Dark Magician', type: 'Normal Monster', frameType: 'normal', desc: 'Wizard.', level: 7, syncedAt: now },
    { id: STARDUST_DRAGON, name: 'Stardust Dragon', type: 'Synchro Monster', frameType: 'synchro', desc: 'Tuner.', level: 8, syncedAt: now },
  ]).run()
}

function quantityIn(db: TestDb, deckId: string, section: 'main' | 'extra' | 'side', cardId: number) {
  return getDeckDetail(db, 'user-a', deckId).sections[section].find(row => row.catalogCardId === cardId)?.quantity
}

describe('validateDeckCardIncrementInput', () => {
  it('takes a positive increment with a card and a section', () => {
    expect(validateDeckCardIncrementInput({ catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1 }))
      .toEqual({ catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1 })
    expect(validateDeckCardIncrementInput({ catalog_card_id: String(DARK_MAGICIAN), section: 'side', increment: '2' }))
      .toEqual({ catalogCardId: DARK_MAGICIAN, section: 'side', increment: 2 })
  })

  it('rejects a bad increment, a missing card or section, and `quantity` next to it', () => {
    for (const increment of [0, -1, 1.5, 'x', MAX_DECK_CARD_QUANTITY + 1, null]) {
      expect(() => validateDeckCardIncrementInput({ catalogCardId: DARK_MAGICIAN, section: 'main', increment }))
        .toThrow(expect.objectContaining({ statusCode: 400 }))
    }
    expect(() => validateDeckCardIncrementInput({ section: 'main', increment: 1 })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateDeckCardIncrementInput({ catalogCardId: DARK_MAGICIAN, section: 'graveyard', increment: 1 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateDeckCardIncrementInput({ catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1, quantity: 2 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateDeckCardIncrementInput('nope')).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('incrementDeckCard', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seed(db)
  })

  it('adds a new row, then adds to it', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })

    const first = incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1 })
    expect(first.sections.main.find(row => row.catalogCardId === DARK_MAGICIAN)?.quantity).toBe(1)

    const second = incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', increment: 2 })
    expect(second.sections.main).toHaveLength(1)
    expect(second.sections.main[0]!.quantity).toBe(3)
    expect(second.counts.main).toBe(3)
  })

  it('counts per section and builds on what the editor set', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 2 })

    incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'side', increment: 1 })
    incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1 })

    expect(quantityIn(db, deck.id, 'main', DARK_MAGICIAN)).toBe(3)
    expect(quantityIn(db, deck.id, 'side', DARK_MAGICIAN)).toBe(1)
  })

  it('keeps copy limits as warnings: a 4th copy is added and warned about', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 3 })

    const detail = incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1 })

    expect(detail.sections.main[0]!.quantity).toBe(4)
    expect(detail.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'copies_above_max', cardId: DARK_MAGICIAN }),
    ]))
  })

  it('rejects a result above the row cap and leaves the row as it was', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: MAX_DECK_CARD_QUANTITY })

    expect(() => incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1 }))
      .toThrow(expect.objectContaining({
        statusCode: 400,
        data: { code: 'quantity_too_large', params: { max: MAX_DECK_CARD_QUANTITY } },
      }))
    expect(quantityIn(db, deck.id, 'main', DARK_MAGICIAN)).toBe(MAX_DECK_CARD_QUANTITY)
  })

  it('has the upsert\'s checks: own deck, known card, allowed section', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })

    expect(() => incrementDeckCard(db, 'user-b', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1 }))
      .toThrow(expect.objectContaining({ statusCode: 404, data: { code: 'deck_not_found' } }))
    expect(() => incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: 999999, section: 'main', increment: 1 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: STARDUST_DRAGON, section: 'main', increment: 1 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))

    const extra = incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: STARDUST_DRAGON, section: 'extra', increment: 1 })
    expect(extra.counts.extra).toBe(1)
    expect(getDeckDetail(db, 'user-a', deck.id).counts.main).toBe(0)
  })

  it('moves the deck to the top of "recently changed"', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    const before = getDeckDetail(db, 'user-a', deck.id).updatedAt.getTime()

    const detail = incrementDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', increment: 1 })

    expect(detail.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})
