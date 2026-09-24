import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { CATALOG_FIXTURE_IDS, seedCatalogFixture } from '../../server/db/fixtures/catalog-fixture'
import * as schema from '../../server/db/schema'
import { parseSuggestLimit, parseSuggestRequest, suggestForRequest } from '../../server/utils/card-entry'
import {
  addOwnedCardsBulk,
  validateInventoryBulkInput,
  validateInventoryInput,
} from '../../server/utils/inventory'

function createTestDb() {
  const sqlite = new Database(':memory:')
  // The app runs with SQLite's default (foreign keys off); the test DB turns
  // them on so a bad write inside the bulk transaction actually fails and the
  // all-or-nothing behavior can be observed.
  sqlite.pragma('foreign_keys = ON')
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

  db.insert(schema.collection).values([
    { id: 'col-a', userId: 'user-a', name: 'Box 1', description: null, createdAt: now, updatedAt: now },
    { id: 'col-b', userId: 'user-b', name: 'Fremde Box', description: null, createdAt: now, updatedAt: now },
  ]).run()

  seedCatalogFixture(db)
}

function item(overrides: Record<string, unknown> = {}) {
  return { catalog_card_id: CATALOG_FIXTURE_IDS.darkMagician, quantity: 1, ...overrides }
}

describe('bulk inventory validation', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seed(db)
  })

  it('accepts snake_case and camelCase items and normalizes defaults', () => {
    const inputs = validateInventoryBulkInput(db, 'user-a', {
      items: [
        item({ printing_id: 'SDY-006' }),
        { catalogCardId: CATALOG_FIXTURE_IDS.potOfGreed, quantity: 2, collectionId: 'col-a', language: 'de' },
      ],
    })

    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toMatchObject({
      catalogCardId: CATALOG_FIXTURE_IDS.darkMagician,
      printingId: 'SDY-006',
      collectionId: null,
      quantity: 1,
      language: 'en',
      condition: 'near_mint',
      edition: 'unlimited',
    })
    expect(inputs[1]).toMatchObject({ collectionId: 'col-a', language: 'de', quantity: 2 })
  })

  it('rejects a malformed envelope', () => {
    expect(() => validateInventoryBulkInput(db, 'user-a', null)).toThrow()
    expect(() => validateInventoryBulkInput(db, 'user-a', { items: 'nope' })).toThrow()
    expect(() => validateInventoryBulkInput(db, 'user-a', { items: [] })).toThrow()
    expect(() => validateInventoryBulkInput(db, 'user-a', {
      items: Array.from({ length: 201 }, () => item()),
    })).toThrow()
  })

  it('rejects a quantity above the per-stack maximum', () => {
    let thrown: { statusCode?: number, data?: { errors?: Array<{ index: number, message: string }> } } | undefined
    try {
      validateInventoryBulkInput(db, 'user-a', { items: [item({ quantity: 1000 })] })
    }
    catch (error) {
      thrown = error as typeof thrown
    }

    expect(thrown?.data?.errors?.[0]).toMatchObject({ index: 0 })
    expect(thrown?.data?.errors?.[0]?.message).toContain('999')
    expect(validateInventoryBulkInput(db, 'user-a', { items: [item({ quantity: 999 })] })[0]?.quantity).toBe(999)
  })

  it('does not translate infrastructure failures into per-item 400s', () => {
    const brokenDb = {
      select: () => {
        throw new Error('database is locked')
      },
    } as unknown as TestDb

    expect(() => validateInventoryBulkInput(brokenDb, 'user-a', { items: [item()] })).toThrow('database is locked')
  })

  it('reports every invalid item with its index', () => {
    let thrown: { statusCode?: number, data?: { errors?: Array<{ index: number, message: string }> } } | undefined
    try {
      validateInventoryBulkInput(db, 'user-a', {
        items: [
          item(),
          item({ quantity: 0 }),
          item({ language: 'xx' }),
          { quantity: 1 },
          item({ catalog_card_id: 999999999 }),
          item({ printing_id: 'LOB-001' }),
        ],
      })
    }
    catch (error) {
      thrown = error as typeof thrown
    }

    expect(thrown?.statusCode).toBe(400)
    expect(thrown?.data?.errors?.map(entry => entry.index)).toEqual([1, 2, 3, 4, 5])
    expect(thrown?.data?.errors?.[0]?.message).toContain('quantity')
    expect(thrown?.data?.errors?.[4]?.message).toContain('printing_id')
  })

  it('rejects a collection owned by another user', () => {
    let thrown: { statusCode?: number, data?: { errors?: Array<{ index: number, message: string }> } } | undefined
    try {
      validateInventoryBulkInput(db, 'user-a', { items: [item(), item({ collection_id: 'col-b' })] })
    }
    catch (error) {
      thrown = error as typeof thrown
    }

    expect(thrown?.statusCode).toBe(400)
    expect(thrown?.data?.errors).toEqual([
      { index: 1, message: 'collection_id does not reference a collection you own', code: 'collection_not_found' },
    ])
  })

  it('writes nothing when any item is invalid', async () => {
    expect(() => validateInventoryBulkInput(db, 'user-a', {
      items: [item(), item({ catalog_card_id: 999999999 })],
    })).toThrow()

    expect(db.select().from(schema.ownedCard).all()).toHaveLength(0)
  })
})

describe('bulk inventory writes', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seed(db)
  })

  it('creates rows and merges duplicates inside one batch', async () => {
    const inputs = validateInventoryBulkInput(db, 'user-a', {
      items: [
        item({ quantity: 2 }),
        item({ quantity: 1 }),
        { catalog_card_id: CATALOG_FIXTURE_IDS.potOfGreed, quantity: 1 },
      ],
    })

    const result = await addOwnedCardsBulk(db, 'user-a', inputs)

    expect(result).toMatchObject({ created: 2, merged: 1 })
    expect(result.items).toHaveLength(3)

    const rows = db.select().from(schema.ownedCard).all()
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.catalogCardId === CATALOG_FIXTURE_IDS.darkMagician)?.quantity).toBe(3)
  })

  it('merges into rows that already exist for the user', async () => {
    await addOwnedCardsBulk(db, 'user-a', validateInventoryBulkInput(db, 'user-a', {
      items: [item({ quantity: 1 })],
    }))

    const result = await addOwnedCardsBulk(db, 'user-a', validateInventoryBulkInput(db, 'user-a', {
      items: [item({ quantity: 4 })],
    }))

    expect(result).toMatchObject({ created: 0, merged: 1 })
    expect(db.select().from(schema.ownedCard).all()[0]?.quantity).toBe(5)
  })

  it('keeps different printings and collections apart', async () => {
    const inputs = validateInventoryBulkInput(db, 'user-a', {
      items: [
        item({ quantity: 1 }),
        item({ quantity: 1, printing_id: 'SDY-006' }),
        item({ quantity: 1, collection_id: 'col-a' }),
      ],
    })

    const result = await addOwnedCardsBulk(db, 'user-a', inputs)

    expect(result).toMatchObject({ created: 3, merged: 0 })
    expect(db.select().from(schema.ownedCard).all()).toHaveLength(3)
  })

  it('rolls the whole batch back when a write fails', async () => {
    const good = validateInventoryInput(item({ quantity: 1 }))
    // Bypasses validation on purpose: a reference that only the database can
    // reject, so the failure happens mid-transaction.
    const broken = validateInventoryInput(item({ quantity: 1, catalog_card_id: 424242 }))

    await expect(addOwnedCardsBulk(db, 'user-a', [good, broken])).rejects.toThrow()
    expect(db.select().from(schema.ownedCard).all()).toHaveLength(0)
  })

  it('scopes ownership to the acting user', async () => {
    await addOwnedCardsBulk(db, 'user-a', validateInventoryBulkInput(db, 'user-a', { items: [item({ quantity: 2 })] }))
    await addOwnedCardsBulk(db, 'user-b', validateInventoryBulkInput(db, 'user-b', { items: [item({ quantity: 5 })] }))

    const rows = db.select().from(schema.ownedCard).all()
    expect(rows).toHaveLength(2)
    expect(rows.filter(row => row.userId === 'user-a')).toHaveLength(1)
    expect(rows.find(row => row.userId === 'user-b')?.quantity).toBe(5)
  })
})

describe('entry suggest handler logic', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seed(db)
  })

  it('returns one result per parsed line, each with its candidates', () => {
    const results = suggestForRequest(db, parseSuggestRequest({ text: '2x Dark Magician\nPot of Greed\nSDY-006' }))

    expect(results).toHaveLength(3)
    expect(results[0]!.input).toMatchObject({ raw: '2x Dark Magician', quantity: 2, query: 'Dark Magician' })
    expect(results[0]!.candidates[0]).toMatchObject({ name: 'Dark Magician', matchedBy: 'exact' })
    expect(results[1]!.candidates[0]).toMatchObject({ name: 'Pot of Greed', matchedBy: 'exact' })
    expect(results[2]!.input.setCode).toBe('SDY-006')
    expect(results[2]!.candidates[0]).toMatchObject({ name: 'Dark Magician', matchedBy: 'set_code' })
  })

  it('returns an empty candidate list instead of failing for unknown cards', () => {
    const results = suggestForRequest(db, parseSuggestRequest({ items: ['Völlig unbekannte Karte'] }))

    expect(results).toHaveLength(1)
    expect(results[0]!.candidates).toEqual([])
  })

  it('clamps the requested limit', () => {
    expect(parseSuggestLimit(undefined)).toBe(5)
    expect(parseSuggestRequest({ items: ['Dark Magician'], limit: 3 }).limit).toBe(3)
    expect(parseSuggestRequest({ items: ['Dark Magician'], limit: 500 }).limit).toBe(20)
    expect(() => parseSuggestRequest({ items: ['Dark Magician'], limit: 0 })).toThrow()
  })
})
