import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  CATALOG_FIXTURE_CARDS,
  CATALOG_FIXTURE_IDS,
  seedCatalogFixture,
} from '../../server/db/fixtures/catalog-fixture'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

describe('catalog fixture', () => {
  it('seeds the fixture cards and stays idempotent on repeated seeding', () => {
    const db = createTestDb()

    seedCatalogFixture(db)
    expect(db.select().from(schema.catalogCard).all()).toHaveLength(CATALOG_FIXTURE_CARDS.length)

    // Re-seeding must upsert (converge to the same rows), not duplicate.
    seedCatalogFixture(db)
    expect(db.select().from(schema.catalogCard).all()).toHaveLength(CATALOG_FIXTURE_CARDS.length)
  })

  it('joins a printing to its card and set', () => {
    const db = createTestDb()
    seedCatalogFixture(db)

    const rows = db
      .select({
        cardName: schema.catalogCard.name,
        setName: schema.catalogSet.name,
        setCode: schema.catalogPrinting.setCode,
      })
      .from(schema.catalogPrinting)
      .innerJoin(schema.catalogCard, eq(schema.catalogPrinting.cardId, schema.catalogCard.id))
      .innerJoin(schema.catalogSet, eq(schema.catalogPrinting.setId, schema.catalogSet.id))
      .where(eq(schema.catalogPrinting.id, 'LOB-005'))
      .all()

    expect(rows).toEqual([
      {
        cardName: 'Dark Magician',
        setName: 'Legend of Blue Eyes White Dragon',
        setCode: 'LOB-005',
      },
    ])
  })

  it('gives every fixture card at least one image row', () => {
    const db = createTestDb()
    seedCatalogFixture(db)

    for (const id of Object.values(CATALOG_FIXTURE_IDS)) {
      const images = db.select().from(schema.catalogCardImage).where(eq(schema.catalogCardImage.cardId, id)).all()
      expect(images.length).toBeGreaterThan(0)
    }
  })
})
