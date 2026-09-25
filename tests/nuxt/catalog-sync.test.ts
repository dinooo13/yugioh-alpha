import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { backfillCatalogNameSearch, syncCatalog } from '../../server/utils/catalog-sync'
import {
  darkMagicianFixture,
  droppedFixture,
  oddEyesFixture,
  oddEyesStaleFixture,
  placeholderFixture,
  placeholderRealFixture,
  potOfGreedFixture,
} from './fixtures/ygoprodeck-cards'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

describe('syncCatalog', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
  })

  it('upserts cards, sets, printings, and images idempotently', async () => {
    const fetchAllCards = async () => [darkMagicianFixture, potOfGreedFixture]

    const first = await syncCatalog(db, { fetchAllCards })
    expect(first.cardCount).toBe(2)

    const cardsAfterFirst = db.select().from(schema.catalogCard).all()
    const setsAfterFirst = db.select().from(schema.catalogSet).all()
    const printingsAfterFirst = db.select().from(schema.catalogPrinting).all()
    const imagesAfterFirst = db.select().from(schema.catalogCardImage).all()

    expect(cardsAfterFirst).toHaveLength(2)
    // Both fixtures share the "Legend of Blue Eyes White Dragon" set.
    expect(setsAfterFirst).toHaveLength(2)
    expect(printingsAfterFirst).toHaveLength(3)
    expect(imagesAfterFirst).toHaveLength(2)

    // Re-running should converge to the same row counts, not duplicate.
    const second = await syncCatalog(db, { fetchAllCards })
    expect(second.cardCount).toBe(2)

    expect(db.select().from(schema.catalogCard).all()).toHaveLength(2)
    expect(db.select().from(schema.catalogSet).all()).toHaveLength(2)
    expect(db.select().from(schema.catalogPrinting).all()).toHaveLength(3)
    expect(db.select().from(schema.catalogCardImage).all()).toHaveLength(2)

    const dmAfterSecond = db
      .select()
      .from(schema.catalogCard)
      .all()
      .find(card => card.id === darkMagicianFixture.id)!
    expect(dmAfterSecond.syncedAt.getTime()).toBeGreaterThan(0)
    expect(dmAfterSecond).toMatchObject({ konamiId: 4041, nameSearch: 'darkmagician' })
  })

  it('records a successful run with the card count', async () => {
    const fetchAllCards = async () => [darkMagicianFixture]

    const result = await syncCatalog(db, { fetchAllCards })

    const runs = db.select().from(schema.catalogSync).all()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      id: result.runId,
      status: 'success',
      cardCount: 1,
    })
    expect(runs[0]!.finishedAt).not.toBeNull()
  })

  it('retires cards the response no longer lists and links their replacement', async () => {
    const first = await syncCatalog(db, {
      fetchAllCards: async () => [darkMagicianFixture, oddEyesStaleFixture, placeholderFixture, droppedFixture],
    })
    expect(first).toEqual({
      runId: first.runId,
      cardCount: 4,
      retirement: {
        retired: 0,
        restored: 0,
        withReplacement: 0,
        withoutReplacement: 0,
        remapped: { ownedCards: 0, deckCards: 0, deckCovers: 0, wishlistItems: 0, ruleFormats: 0 },
        skipped: false,
      },
      cleanup: { printings: 0, images: 0, skipped: false },
    })

    const second = await syncCatalog(db, {
      fetchAllCards: async () => [darkMagicianFixture, oddEyesFixture, placeholderRealFixture],
    })
    expect(second.cardCount).toBe(3)
    expect(second.retirement).toMatchObject({ retired: 3, restored: 0, withReplacement: 2, withoutReplacement: 1, skipped: false })
    // The placeholder images of the two replaced cards; the dropped card keeps its own.
    expect(second.cleanup).toEqual({ printings: 0, images: 2, skipped: false })

    const rows = new Map(db.select().from(schema.catalogCard).all().map(row => [row.id, row]))
    expect(rows.size).toBe(6)
    expect(rows.get(oddEyesStaleFixture.id)).toMatchObject({ replacedById: oddEyesFixture.id })
    expect(rows.get(placeholderFixture.id)).toMatchObject({ replacedById: placeholderRealFixture.id })
    expect(rows.get(droppedFixture.id)).toMatchObject({ replacedById: null })
    for (const id of [oddEyesStaleFixture.id, placeholderFixture.id, droppedFixture.id]) {
      expect(rows.get(id)!.retiredAt).toBeInstanceOf(Date)
    }
    for (const id of [darkMagicianFixture.id, oddEyesFixture.id, placeholderRealFixture.id]) {
      expect(rows.get(id)).toMatchObject({ retiredAt: null, replacedById: null })
    }
  })

  it('records an error run and re-raises when the fetch fails', async () => {
    const fetchAllCards = async () => {
      throw new Error('network exploded')
    }

    await expect(syncCatalog(db, { fetchAllCards })).rejects.toThrow('network exploded')

    const runs = db.select().from(schema.catalogSync).all()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'error', error: 'network exploded' })
  })
})

describe('backfillCatalogNameSearch', () => {
  it('folds the names of rows without a search name, once', () => {
    const db = createTestDb()
    // Rows as they look right after migration 0012, or inserted by a test
    // that doesn't know the column.
    db.insert(schema.catalogCard).values([
      { id: 1, name: 'Blue-Eyes White Dragon', type: 'Normal Monster', desc: '', syncedAt: new Date(0) },
      { id: 2, name: 'Élan Straße', type: 'Normal Monster', desc: '', syncedAt: new Date(0) },
      { id: 3, name: 'Already Folded', type: 'Normal Monster', desc: '', syncedAt: new Date(0), nameSearch: 'custom' },
      { id: 4, name: '???', type: 'Normal Monster', desc: '', syncedAt: new Date(0) },
    ]).run()

    expect(backfillCatalogNameSearch(db)).toBe(2)

    const rows = db
      .select({ id: schema.catalogCard.id, nameSearch: schema.catalogCard.nameSearch })
      .from(schema.catalogCard)
      .all()
      .sort((a, b) => a.id - b.id)
    expect(rows).toEqual([
      { id: 1, nameSearch: 'blueeyeswhitedragon' },
      { id: 2, nameSearch: 'elanstrasse' },
      { id: 3, nameSearch: 'custom' },
      // Folds to nothing: stays '' (the raw LIKE on name still finds it).
      { id: 4, nameSearch: '' },
    ])

    expect(backfillCatalogNameSearch(db)).toBe(0)
  })
})
