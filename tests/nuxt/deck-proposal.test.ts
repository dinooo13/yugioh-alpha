import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { addOwnedCard, validateInventoryInput } from '../../server/utils/inventory'
import { createDeck, updateDeck, upsertDeckCard } from '../../server/utils/decks'
import { createRuleFormat, validateRuleFormatInput } from '../../server/utils/rule-formats'
import { maxCopiesByCard } from '../../server/utils/deck-validation'
import { previewDeckProposal } from '../../server/utils/deck-proposal'

const CARD = {
  darkMagician: 46986414,
  potOfGreed: 55144522,
  mirrorForce: 44095762,
  stardustDragon: 44508094,
} as const

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
    { id: CARD.darkMagician, name: 'Dark Magician', type: 'Normal Monster', frameType: 'normal', desc: 'x', syncedAt: now },
    { id: CARD.potOfGreed, name: 'Pot of Greed', type: 'Spell Card', frameType: 'spell', desc: 'x', syncedAt: now },
    { id: CARD.mirrorForce, name: 'Mirror Force', type: 'Trap Card', frameType: 'trap', desc: 'x', syncedAt: now },
    { id: CARD.stardustDragon, name: 'Stardust Dragon', type: 'Synchro Monster', frameType: 'synchro', desc: 'x', syncedAt: now },
  ]).run()
}

function own(db: TestDb, userId: string, catalogCardId: number, quantity: number) {
  return addOwnedCard(db, userId, validateInventoryInput({ catalog_card_id: catalogCardId, quantity }))
}

// A card_status ban plus a filter cap — the same rule mix the former
// one-shot deck assistant's candidate-pool tests used (ADR 0006).
const FORBID_AND_CAP_RULES = {
  rules: [
    { kind: 'card_status' as const, status: 'forbidden' as const, cardIds: [CARD.potOfGreed] },
    { kind: 'filter' as const, match: 'matching' as const, filter: { types: ['Trap Card'] }, maxCopies: 1 as const, label: 'Fallen limitiert' },
  ],
}

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  seed(db)
})

describe('maxCopiesByCard', () => {
  it('reports the rule engine\'s per-card cap: 0 for a forbidden card, the filter cap, 3 otherwise', () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))

    const caps = maxCopiesByCard(db, format.rules, [CARD.darkMagician, CARD.potOfGreed, CARD.mirrorForce, CARD.stardustDragon])

    expect(caps.get(CARD.potOfGreed)).toBe(0)
    expect(caps.get(CARD.mirrorForce)).toBe(1)
    expect(caps.get(CARD.darkMagician)).toBe(3)
    expect(caps.get(CARD.stardustDragon)).toBe(3)
  })

  it('falls back to a cap of 3 for every card without a format', () => {
    const caps = maxCopiesByCard(db, null, [CARD.potOfGreed, CARD.mirrorForce])
    expect([...caps.values()]).toEqual([3, 3])
  })
})

describe('previewDeckProposal', () => {
  it('previews a planned new deck: counts, legality under a format, and missing cards vs. the inventory', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))
    await own(db, 'user-a', CARD.darkMagician, 1)
    await own(db, 'user-a', CARD.mirrorForce, 2)

    const preview = previewDeckProposal(db, 'user-a', {
      cards: [
        { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 },
        { catalogCardId: CARD.mirrorForce, section: 'main', quantity: 2 },
        { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 },
      ],
      formatId: format.id,
    })

    expect(preview).toMatchObject({
      formatId: format.id,
      formatName: 'Verbot',
      counts: { main: 5, extra: 1, side: 0, total: 6 },
      validation: { legal: false },
      missing: [
        { catalogCardId: CARD.darkMagician, name: 'Dark Magician', needed: 3, owned: 1 },
        { catalogCardId: CARD.stardustDragon, name: 'Stardust Dragon', needed: 1, owned: 0 },
      ],
    })
    expect(preview.validation!.issues.some(issue => issue.includes('Mirror Force'))).toBe(true)
  })

  it('returns no legality statement without a format', () => {
    const preview = previewDeckProposal(db, 'user-a', { cards: [{ catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 }] })
    expect(preview.formatId).toBeNull()
    expect(preview.validation).toBeNull()
  })

  it('applies absolute changes on top of an existing deck and uses the deck\'s own format', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))
    const deck = createDeck(db, 'user-a', { name: 'Mein Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.mirrorForce, section: 'main', quantity: 1 })
    updateDeck(db, 'user-a', deck.id, { formatId: format.id })
    await own(db, 'user-a', CARD.darkMagician, 3)

    const preview = previewDeckProposal(db, 'user-a', {
      deckId: deck.id,
      changes: [
        { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 },
        { catalogCardId: CARD.mirrorForce, section: 'main', quantity: 0 },
        { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 },
      ],
    })

    expect(preview.formatName).toBe('Verbot')
    expect(preview.counts).toEqual({ main: 4, extra: 0, side: 0, total: 4 })
    expect(preview.validation!.legal).toBe(false)
    expect(preview.validation!.issues.some(issue => issue.includes('Pot of Greed'))).toBe(true)
    expect(preview.missing).toEqual([{ catalogCardId: CARD.potOfGreed, name: 'Pot of Greed', nameDe: null, needed: 1, owned: 0 }])
  })

  it('with formatId null previews an existing deck without any format, even though it has one', () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))
    const deck = createDeck(db, 'user-a', { name: 'Mein Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 })
    updateDeck(db, 'user-a', deck.id, { formatId: format.id })

    const preview = previewDeckProposal(db, 'user-a', { deckId: deck.id, formatId: null })
    expect(preview.formatId).toBeNull()
    expect(preview.formatName).toBeNull()
    expect(preview.validation).toBeNull()
    expect(preview.counts.total).toBe(1)
  })

  it('404s for another user\'s deck', async () => {
    const foreign = createDeck(db, 'user-b', { name: 'Fremd', description: null })
    let statusCode: number | undefined
    try {
      previewDeckProposal(db, 'user-a', { deckId: foreign.id, changes: [] })
    }
    catch (error) {
      statusCode = (error as { statusCode?: number }).statusCode
    }
    expect(statusCode).toBe(404)
  })
})
