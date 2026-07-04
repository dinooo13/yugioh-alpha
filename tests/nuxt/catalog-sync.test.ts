import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { syncCatalog } from '../../server/utils/catalog-sync'
import { darkMagicianFixture, potOfGreedFixture } from './fixtures/ygoprodeck-cards'

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
