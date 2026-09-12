import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  createDeck,
  DECK_LIMITS,
  duplicateNameFor,
  defaultSectionForCard,
  deleteDeck,
  duplicateDeck,
  getDeckDetail,
  isExtraDeckCard,
  listDecks,
  MAX_DECK_CARD_QUANTITY,
  moveDeckCard,
  parseDeckListQuery,
  removeDeckCard,
  updateDeck,
  upsertDeckCard,
  validateDeckCardInput,
  validateDeckCardMoveInput,
  validateDeckCreateCardsInput,
  validateDeckInput,
  validateDeckUpdateInput,
} from '../../server/utils/decks'
import { createCollection } from '../../server/utils/collections'
import { addOwnedCard, validateInventoryInput } from '../../server/utils/inventory'

const CARD = {
  darkMagician: 46986414,
  potOfGreed: 55144522,
  mirrorForce: 44095762,
  stardustDragon: 44508094,
  decodeTalker: 1861629,
  blueEyesUltimateDragon: 23995346,
  utopia: 84013237,
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
    {
      id: CARD.darkMagician,
      name: 'Dark Magician',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'The ultimate wizard.',
      attribute: 'DARK',
      level: 7,
      syncedAt: now,
    },
    {
      id: CARD.potOfGreed,
      name: 'Pot of Greed',
      type: 'Spell Card',
      frameType: 'spell',
      desc: 'Draw two cards.',
      syncedAt: now,
    },
    {
      id: CARD.mirrorForce,
      name: 'Mirror Force',
      type: 'Trap Card',
      frameType: 'trap',
      desc: 'Destroy all attacking monsters.',
      syncedAt: now,
    },
    {
      id: CARD.stardustDragon,
      name: 'Stardust Dragon',
      type: 'Synchro Monster',
      frameType: 'synchro',
      desc: 'Tuner + 1 or more non-Tuner monsters.',
      attribute: 'WIND',
      level: 8,
      syncedAt: now,
    },
    {
      id: CARD.decodeTalker,
      name: 'Decode Talker',
      type: 'Link Monster',
      frameType: 'link',
      desc: '2+ Effect Monsters.',
      attribute: 'DARK',
      syncedAt: now,
    },
    {
      id: CARD.blueEyesUltimateDragon,
      name: 'Blue-Eyes Ultimate Dragon',
      type: 'Fusion Monster',
      frameType: 'fusion',
      desc: 'Blue-Eyes White Dragon + Blue-Eyes White Dragon + Blue-Eyes White Dragon',
      attribute: 'LIGHT',
      level: 12,
      syncedAt: now,
    },
    {
      id: CARD.utopia,
      name: 'Number 39: Utopia',
      type: 'XYZ Monster',
      frameType: 'xyz',
      desc: '2 Level 4 monsters.',
      attribute: 'LIGHT',
      syncedAt: now,
    },
  ]).run()
}

function own(db: TestDb, userId: string, catalogCardId: number, quantity: number, extra: Record<string, unknown> = {}) {
  return addOwnedCard(db, userId, validateInventoryInput({
    catalog_card_id: catalogCardId,
    quantity,
    ...extra,
  }))
}

describe('deck section rules', () => {
  it('routes fusion/synchro/xyz/link monsters to the extra deck', () => {
    expect(isExtraDeckCard({ type: 'Fusion Monster', frameType: 'fusion' })).toBe(true)
    expect(isExtraDeckCard({ type: 'Synchro Tuner Monster', frameType: 'synchro' })).toBe(true)
    expect(isExtraDeckCard({ type: 'XYZ Monster', frameType: 'xyz' })).toBe(true)
    expect(isExtraDeckCard({ type: 'Link Monster', frameType: 'link' })).toBe(true)
    expect(isExtraDeckCard({ type: 'Pendulum Effect Fusion Monster', frameType: 'fusion_pendulum' })).toBe(true)

    expect(isExtraDeckCard({ type: 'Normal Monster', frameType: 'normal' })).toBe(false)
    expect(isExtraDeckCard({ type: 'Effect Monster', frameType: 'effect' })).toBe(false)
    expect(isExtraDeckCard({ type: 'Ritual Monster', frameType: 'ritual' })).toBe(false)
    expect(isExtraDeckCard({ type: 'Spell Card', frameType: 'spell' })).toBe(false)
    expect(isExtraDeckCard({ type: 'Trap Card', frameType: 'trap' })).toBe(false)
  })

  it('derives the default section from the card type', () => {
    expect(defaultSectionForCard({ type: 'Synchro Monster' })).toBe('extra')
    expect(defaultSectionForCard({ type: 'Spell Card' })).toBe('main')
  })
})

describe('deck validation', () => {
  it('normalizes and rejects deck input', () => {
    expect(validateDeckInput({ name: '  Blue-Eyes  ' })).toEqual({ name: 'Blue-Eyes', description: null })
    expect(validateDeckInput({ name: 'Deck', description: '  schnell  ' })).toEqual({ name: 'Deck', description: 'schnell' })

    expect(() => validateDeckInput({ name: '' })).toThrow()
    expect(() => validateDeckInput({ name: '   ' })).toThrow()
    expect(() => validateDeckInput({ name: 'a'.repeat(81) })).toThrow()
    expect(() => validateDeckInput({ name: 'Deck', description: 'x'.repeat(501) })).toThrow()
    expect(() => validateDeckInput('nope')).toThrow()
  })

  it('only validates provided fields on update', () => {
    expect(validateDeckUpdateInput({})).toEqual({})
    expect(validateDeckUpdateInput({ name: 'Neu' })).toEqual({ name: 'Neu' })
    expect(validateDeckUpdateInput({ description: null })).toEqual({ description: null })
    expect(() => validateDeckUpdateInput({ name: '' })).toThrow()
  })

  it('accepts snake_case and camelCase deck card input', () => {
    expect(validateDeckCardInput({ catalog_card_id: 1, section: 'main', quantity: 2 }))
      .toEqual({ catalogCardId: 1, section: 'main', quantity: 2 })
    expect(validateDeckCardInput({ catalogCardId: 1, section: 'side' }))
      .toEqual({ catalogCardId: 1, section: 'side', quantity: 1 })
    // 0 is the documented "remove this row" quantity.
    expect(validateDeckCardInput({ catalogCardId: 1, section: 'side', quantity: 0 }).quantity).toBe(0)

    expect(() => validateDeckCardInput({ catalogCardId: 1, section: 'graveyard' })).toThrow()
    expect(() => validateDeckCardInput({ catalogCardId: 0, section: 'main' })).toThrow()
    expect(() => validateDeckCardInput({ catalogCardId: 1, section: 'main', quantity: -1 })).toThrow()
  })

  it('caps a deck card quantity and rejects unsafe numbers', () => {
    expect(validateDeckCardInput({ catalogCardId: 1, section: 'main', quantity: MAX_DECK_CARD_QUANTITY }).quantity)
      .toBe(MAX_DECK_CARD_QUANTITY)

    expect(() => validateDeckCardInput({ catalogCardId: 1, section: 'main', quantity: MAX_DECK_CARD_QUANTITY + 1 })).toThrow()
    expect(() => validateDeckCardInput({ catalogCardId: 1, section: 'main', quantity: 1e20 })).toThrow()
    expect(() => validateDeckCardInput({ catalogCardId: 1, section: 'main', quantity: 1.5 })).toThrow()
    expect(() => validateDeckCardInput({ catalogCardId: 1e20, section: 'main' })).toThrow()
    expect(() => validateDeckCardMoveInput({ catalogCardId: 1, from: 'main', to: 'side', quantity: 1e20 })).toThrow()
  })

  it('keeps the "(Kopie)" suffix inside the 80 character name limit', () => {
    expect(duplicateNameFor('Kurz')).toBe('Kurz (Kopie)')

    const longName = 'D'.repeat(80)
    const copyName = duplicateNameFor(longName)
    expect(copyName).toHaveLength(80)
    expect(copyName.endsWith(' (Kopie)')).toBe(true)
  })

  it('rejects a move between identical sections', () => {
    expect(validateDeckCardMoveInput({ catalogCardId: 1, from: 'main', to: 'side' }))
      .toEqual({ catalogCardId: 1, from: 'main', to: 'side', quantity: undefined })
    expect(() => validateDeckCardMoveInput({ catalogCardId: 1, from: 'main', to: 'main' })).toThrow()
    expect(() => validateDeckCardMoveInput({ catalogCardId: 1, from: 'main', to: 'side', quantity: 0 })).toThrow()
  })

  it('parses and clamps the list query', () => {
    expect(parseDeckListQuery({ q: '  Blue  ', sort: 'name', page: '2', pageSize: '5', contains: '46986414' }))
      .toEqual({ q: 'Blue', sort: 'name', page: 2, pageSize: 5, contains: 46986414 })
    expect(parseDeckListQuery({ sort: 'bogus', page: '-1' }))
      .toEqual({ q: undefined, sort: undefined, page: undefined, pageSize: undefined, contains: undefined })
  })

  it('validates the optional cards array on deck creation', () => {
    expect(validateDeckCreateCardsInput({ name: 'Deck' })).toBeUndefined()

    expect(validateDeckCreateCardsInput({
      cards: [
        { catalog_card_id: CARD.darkMagician, section: 'main', quantity: 2 },
        { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 },
      ],
    })).toEqual([
      { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 },
      { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 },
    ])

    expect(() => validateDeckCreateCardsInput({ cards: 'nope' })).toThrow(expect.objectContaining({ statusCode: 400 }))
    // Unlike the upsert endpoint, quantity 0 is not a valid "remove" here.
    expect(() => validateDeckCreateCardsInput({ cards: [{ catalogCardId: CARD.darkMagician, section: 'main', quantity: 0 }] }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('deck creation with cards', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('creates the deck and its cards in one call', () => {
    const cards = validateDeckCreateCardsInput({
      cards: [
        { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 },
        { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 },
        { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 },
      ],
    })!

    const created = createDeck(db, 'user-a', validateDeckInput({ name: 'KI-Vorschlag' }), cards)

    // Duplicate (catalogCardId, section) entries are merged.
    expect(created.sections.main).toEqual([expect.objectContaining({ catalogCardId: CARD.darkMagician, quantity: 3 })])
    expect(created.sections.extra).toEqual([expect.objectContaining({ catalogCardId: CARD.stardustDragon, quantity: 1 })])
    expect(getDeckDetail(db, 'user-a', created.id).counts).toMatchObject({ main: 3, extra: 1, total: 4 })
  })

  it('rejects an unknown catalog card and rolls back the whole deck', () => {
    const cards = [{ catalogCardId: 999999999, section: 'main' as const, quantity: 1 }]

    expect(() => createDeck(db, 'user-a', validateDeckInput({ name: 'Kaputt' }), cards))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(listDecks(db, 'user-a').items).toEqual([])
  })

  it('rejects a card placed in a section its type forbids', () => {
    const cards = [{ catalogCardId: CARD.stardustDragon, section: 'main' as const, quantity: 1 }]

    expect(() => createDeck(db, 'user-a', validateDeckInput({ name: 'Kaputt' }), cards))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(listDecks(db, 'user-a').items).toEqual([])
  })

  it('ignores a cards field on update, same as any other unknown key', () => {
    const created = createDeck(db, 'user-a', validateDeckInput({ name: 'Deck' }))

    const patch = validateDeckUpdateInput({ name: 'Umbenannt', cards: [{ catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 }] })
    expect(patch).toEqual({ name: 'Umbenannt' })

    const updated = updateDeck(db, 'user-a', created.id, patch)
    expect(updated.counts.total).toBe(0)
  })
})

describe('deck persistence', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('creates, reads, renames, and deletes a deck', () => {
    const created = createDeck(db, 'user-a', { name: 'Blue-Eyes', description: 'Beatdown' })

    expect(created).toMatchObject({ name: 'Blue-Eyes', description: 'Beatdown' })
    expect(created.sections).toEqual({ main: [], extra: [], side: [] })
    expect(created.counts).toEqual({ main: 0, extra: 0, side: 0, total: 0 })
    expect(created.limits).toEqual(DECK_LIMITS)

    expect(getDeckDetail(db, 'user-a', created.id).name).toBe('Blue-Eyes')

    const renamed = updateDeck(db, 'user-a', created.id, { name: 'Blue-Eyes Control' })
    expect(renamed.name).toBe('Blue-Eyes Control')
    expect(renamed.description).toBe('Beatdown')

    deleteDeck(db, 'user-a', created.id)
    expect(() => getDeckDetail(db, 'user-a', created.id)).toThrow(expect.objectContaining({ statusCode: 404 }))
  })

  it('hides another user deck behind a 404 for reads and writes', () => {
    const deck = createDeck(db, 'user-a', { name: 'Privat', description: null })

    expect(() => getDeckDetail(db, 'user-b', deck.id)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => updateDeck(db, 'user-b', deck.id, { name: 'Geklaut' })).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => deleteDeck(db, 'user-b', deck.id)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => duplicateDeck(db, 'user-b', deck.id)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => upsertDeckCard(db, 'user-b', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 }))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => moveDeckCard(db, 'user-b', deck.id, { catalogCardId: CARD.darkMagician, from: 'main', to: 'side' }))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => removeDeckCard(db, 'user-b', deck.id, CARD.darkMagician, 'main'))
      .toThrow(expect.objectContaining({ statusCode: 404 }))

    // The deck itself is untouched.
    expect(getDeckDetail(db, 'user-a', deck.id).name).toBe('Privat')
  })

  it('rejects cards in a section their type forbids', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })

    expect(() => upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.stardustDragon, section: 'main', quantity: 1 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'extra', quantity: 1 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: 999999, section: 'main', quantity: 1 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))

    // 'side' takes both, 'extra' takes extra-deck monsters.
    const withSide = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.stardustDragon, section: 'side', quantity: 1 })
    expect(withSide.counts.side).toBe(1)
    const withExtra = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.utopia, section: 'extra', quantity: 1 })
    expect(withExtra.counts.extra).toBe(1)
  })

  it('upserts a card quantity and removes the row on quantity 0', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })

    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    let detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })

    expect(detail.sections.main).toHaveLength(1)
    expect(detail.sections.main[0]).toMatchObject({ catalogCardId: CARD.darkMagician, quantity: 3 })
    expect(detail.counts.main).toBe(3)

    detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 0 })
    expect(detail.sections.main).toHaveLength(0)
    expect(db.select().from(schema.deckCard).where(eq(schema.deckCard.deckId, deck.id)).all()).toHaveLength(0)
  })

  it('removes a card explicitly and 404s on a row that is not there', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 })

    const detail = removeDeckCard(db, 'user-a', deck.id, CARD.potOfGreed, 'main')
    expect(detail.counts.total).toBe(0)

    expect(() => removeDeckCard(db, 'user-a', deck.id, CARD.potOfGreed, 'main'))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
  })

  it('moves copies between sections, merging into an existing target row', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'side', quantity: 1 })

    // Partial move merges into the existing side row.
    let detail = moveDeckCard(db, 'user-a', deck.id, {
      catalogCardId: CARD.darkMagician,
      from: 'main',
      to: 'side',
      quantity: 2,
    })
    expect(detail.counts).toMatchObject({ main: 1, side: 3 })

    // Full move empties the source section.
    detail = moveDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, from: 'main', to: 'side' })
    expect(detail.sections.main).toHaveLength(0)
    expect(detail.counts.side).toBe(4)

    expect(() => moveDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, from: 'main', to: 'side' }))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => moveDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, from: 'side', to: 'extra' }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => moveDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, from: 'side', to: 'main', quantity: 99 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('duplicates a deck with its cards under a "(Kopie)" name', () => {
    const deck = createDeck(db, 'user-a', { name: 'Original', description: 'Notiz' })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 })

    const copy = duplicateDeck(db, 'user-a', deck.id)

    expect(copy.id).not.toBe(deck.id)
    expect(copy.name).toBe('Original (Kopie)')
    expect(copy.description).toBe('Notiz')
    expect(copy.counts).toMatchObject({ main: 3, extra: 1, total: 4 })

    // Editing the copy leaves the original alone.
    upsertDeckCard(db, 'user-a', copy.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 })
    expect(getDeckDetail(db, 'user-a', deck.id).counts.main).toBe(3)
  })

  it('removes the deck cards when the deck is deleted', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 })

    expect(db.select().from(schema.deckCard).where(eq(schema.deckCard.deckId, deck.id)).all()).toHaveLength(2)

    deleteDeck(db, 'user-a', deck.id)

    expect(db.select().from(schema.deckCard).where(eq(schema.deckCard.deckId, deck.id)).all()).toHaveLength(0)
  })

  it('does not touch updatedAt for an empty patch', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    const before = db.select().from(schema.deck).where(eq(schema.deck.id, deck.id)).get()!.updatedAt

    const unchanged = updateDeck(db, 'user-a', deck.id, {})
    expect(unchanged.updatedAt).toEqual(before)
    expect(db.select().from(schema.deck).where(eq(schema.deck.id, deck.id)).get()!.updatedAt).toEqual(before)
  })

  it('sorts the main deck monsters, spells, traps, then by name', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.mirrorForce, section: 'main', quantity: 1 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 })
    const detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 })

    expect(detail.sections.main.map(row => row.name)).toEqual(['Dark Magician', 'Pot of Greed', 'Mirror Force'])
  })
})

describe('deck availability', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('sums owned copies across collections, conditions, and languages', async () => {
    const box = await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    await own(db, 'user-a', CARD.darkMagician, 1, { collection_id: box.id })
    await own(db, 'user-a', CARD.darkMagician, 1, { language: 'de' })
    await own(db, 'user-a', CARD.darkMagician, 1, { condition: 'played' })
    // Another user's copies never count.
    await own(db, 'user-b', CARD.darkMagician, 10)

    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    const detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })

    expect(detail.sections.main[0]).toMatchObject({ owned: 3, usedInDeck: 3, shortfall: 0 })
  })

  it('counts usage across sections and reports the shortfall per row', async () => {
    await own(db, 'user-a', CARD.darkMagician, 2)

    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    const detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'side', quantity: 1 })

    expect(detail.sections.main[0]).toMatchObject({ quantity: 2, owned: 2, usedInDeck: 3, shortfall: 1 })
    expect(detail.sections.side[0]).toMatchObject({ quantity: 1, owned: 2, usedInDeck: 3, shortfall: 1 })
  })

  it('reports owned 0 for a card that is only in the catalog', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    const detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 })

    expect(detail.sections.main[0]).toMatchObject({ owned: 0, usedInDeck: 1, shortfall: 1 })
  })

  it('does not reserve owned copies across decks', async () => {
    await own(db, 'user-a', CARD.darkMagician, 3)

    const deckOne = createDeck(db, 'user-a', { name: 'Deck 1', description: null })
    const deckTwo = createDeck(db, 'user-a', { name: 'Deck 2', description: null })
    const detailOne = upsertDeckCard(db, 'user-a', deckOne.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })
    const detailTwo = upsertDeckCard(db, 'user-a', deckTwo.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })

    expect(detailOne.sections.main[0]!.shortfall).toBe(0)
    expect(detailTwo.sections.main[0]!.shortfall).toBe(0)
  })
})

describe('deck warnings', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('warns about an undersized main deck', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    const detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })

    expect(detail.warnings.map(warning => warning.code)).toContain('main_below_min')
    expect(detail.warnings[0]!.message).toContain('40')
  })

  it('warns about an oversized main, extra, and side deck', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 61 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 16 })
    const detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.mirrorForce, section: 'side', quantity: 16 })

    const codes = detail.warnings.map(warning => warning.code)
    expect(codes).toContain('main_above_max')
    expect(codes).toContain('extra_above_max')
    expect(codes).toContain('side_above_max')
    expect(codes).not.toContain('main_below_min')
  })

  it('warns about more than three copies of a card across the whole deck', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'side', quantity: 2 })
    // Extra deck copies count towards the same limit.
    const detail = upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 5 })

    const copyWarnings = detail.warnings.filter(warning => warning.code === 'copies_above_max')
    expect(copyWarnings.map(warning => warning.cardId).sort())
      .toEqual([CARD.stardustDragon, CARD.darkMagician].sort())
    expect(copyWarnings.find(warning => warning.cardId === CARD.darkMagician)!.message)
      .toContain('Dark Magician: 4 Kopien')

    // Over-limit quantities are warnings, never hard errors: the write stuck.
    expect(detail.counts).toMatchObject({ main: 2, side: 2, extra: 5 })
  })

  it('accepts at most 99 copies in one row', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })

    const detail = upsertDeckCard(db, 'user-a', deck.id, {
      catalogCardId: CARD.potOfGreed,
      section: 'main',
      quantity: MAX_DECK_CARD_QUANTITY,
    })
    expect(detail.counts.main).toBe(MAX_DECK_CARD_QUANTITY)

    expect(() => validateDeckCardInput({
      catalogCardId: CARD.potOfGreed,
      section: 'main',
      quantity: MAX_DECK_CARD_QUANTITY + 1,
    })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('deck list', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('returns per-section counts, completeness, and missing copies', async () => {
    await own(db, 'user-a', CARD.darkMagician, 2)
    await own(db, 'user-a', CARD.stardustDragon, 1)

    const deck = createDeck(db, 'user-a', { name: 'Test Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 })

    const result = listDecks(db, 'user-a')
    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({
      name: 'Test Deck',
      mainCount: 3,
      extraCount: 1,
      sideCount: 0,
      cardCount: 4,
      complete: false,
      missingCount: 1,
    })

    // Buying the third copy completes the deck.
    await own(db, 'user-a', CARD.darkMagician, 1)
    expect(listDecks(db, 'user-a').items[0]).toMatchObject({ complete: true, missingCount: 0 })
  })

  it('does not call an empty deck complete', () => {
    createDeck(db, 'user-a', { name: 'Leeres Deck', description: null })

    expect(listDecks(db, 'user-a').items[0]).toMatchObject({
      cardCount: 0,
      complete: false,
      missingCount: 0,
    })
  })

  it('counts missing copies per card across sections, not per row', async () => {
    await own(db, 'user-a', CARD.darkMagician, 3)

    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'side', quantity: 2 })

    // 4 copies used, 3 owned -> exactly 1 missing (not 1 per section).
    expect(listDecks(db, 'user-a').items[0]).toMatchObject({ cardCount: 4, missingCount: 1, complete: false })
  })

  it('scopes the list to the requesting user', () => {
    createDeck(db, 'user-a', { name: 'A-Deck', description: null })
    createDeck(db, 'user-b', { name: 'B-Deck', description: null })

    expect(listDecks(db, 'user-a').items.map(item => item.name)).toEqual(['A-Deck'])
    expect(listDecks(db, 'user-b').items.map(item => item.name)).toEqual(['B-Deck'])
  })

  it('searches by deck name and by the name of a contained card', () => {
    const dragons = createDeck(db, 'user-a', { name: 'Drachen', description: null })
    upsertDeckCard(db, 'user-a', dragons.id, { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 })
    const magicians = createDeck(db, 'user-a', { name: 'Magier', description: null })
    upsertDeckCard(db, 'user-a', magicians.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })

    expect(listDecks(db, 'user-a', { q: 'drach' }).items.map(item => item.name)).toEqual(['Drachen'])
    expect(listDecks(db, 'user-a', { q: 'stardust' }).items.map(item => item.name)).toEqual(['Drachen'])
    expect(listDecks(db, 'user-a', { q: 'Dark Magician' }).items.map(item => item.name)).toEqual(['Magier'])
    expect(listDecks(db, 'user-a', { q: 'nichts' }).items).toEqual([])
    // LIKE wildcards in the term are matched literally.
    expect(listDecks(db, 'user-a', { q: '%' }).items).toEqual([])
  })

  it('never matches a card that is only in another user deck', () => {
    const foreign = createDeck(db, 'user-b', { name: 'B-Deck', description: null })
    upsertDeckCard(db, 'user-b', foreign.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 })
    createDeck(db, 'user-a', { name: 'A-Deck', description: null })

    expect(listDecks(db, 'user-a', { q: 'Dark Magician' }).items).toEqual([])
    expect(listDecks(db, 'user-a', { contains: CARD.darkMagician }).items).toEqual([])
  })

  it('filters by a contained catalog card', () => {
    const withCard = createDeck(db, 'user-a', { name: 'Mit Karte', description: null })
    upsertDeckCard(db, 'user-a', withCard.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 })
    createDeck(db, 'user-a', { name: 'Ohne Karte', description: null })

    expect(listDecks(db, 'user-a', { contains: CARD.darkMagician }).items.map(item => item.name))
      .toEqual(['Mit Karte'])
    expect(listDecks(db, 'user-a', { contains: CARD.potOfGreed }).items).toEqual([])
  })

  it('sorts by name and paginates', () => {
    createDeck(db, 'user-a', { name: 'Charlie', description: null })
    createDeck(db, 'user-a', { name: 'Alpha', description: null })
    createDeck(db, 'user-a', { name: 'Bravo', description: null })

    expect(listDecks(db, 'user-a', { sort: 'name' }).items.map(item => item.name))
      .toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(listDecks(db, 'user-a', { sort: '-name' }).items.map(item => item.name))
      .toEqual(['Charlie', 'Bravo', 'Alpha'])

    const firstPage = listDecks(db, 'user-a', { sort: 'name', page: 1, pageSize: 2 })
    expect(firstPage.items.map(item => item.name)).toEqual(['Alpha', 'Bravo'])
    expect(firstPage.total).toBe(3)
    expect(listDecks(db, 'user-a', { sort: 'name', page: 2, pageSize: 2 }).items.map(item => item.name))
      .toEqual(['Charlie'])

    // Past the last page: no items, but the unpaged total stays intact.
    const beyond = listDecks(db, 'user-a', { sort: 'name', page: 9, pageSize: 2 })
    expect(beyond.items).toEqual([])
    expect(beyond).toMatchObject({ total: 3, page: 9, pageSize: 2 })
  })

  it('sorts by last update, most recent first', () => {
    const first = createDeck(db, 'user-a', { name: 'Zuerst', description: null })
    createDeck(db, 'user-a', { name: 'Danach', description: null })

    // Touching the older deck moves it to the top of the "updated" sort.
    db.update(schema.deck)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.deck.id, first.id))
      .run()

    expect(listDecks(db, 'user-a', { sort: 'updated' }).items.map(item => item.name))
      .toEqual(['Zuerst', 'Danach'])
  })
})
