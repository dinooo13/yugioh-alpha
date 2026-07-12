import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../server/db/schema'
import { addOwnedCard, validateInventoryInput } from '../../server/utils/inventory'
import { assertCollectionOwnedByUser, createCollection } from '../../server/utils/collections'
import {
  buildInventorySearchWhere,
  parseInventorySearchQuery,
  UNASSIGNED_COLLECTION_ID,
} from '../../server/utils/inventory-search'
import type { InventorySearchSort } from '../../server/utils/inventory-search'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

function seedUsers(db: TestDb) {
  const now = new Date()
  db.insert(schema.user).values([
    {
      id: 'user-a',
      name: 'User A',
      email: 'a@example.com',
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'user-b',
      name: 'User B',
      email: 'b@example.com',
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
  ]).run()
}

interface CardSeed {
  id: number
  name: string
  type: string
  desc?: string
  attribute?: string | null
  race?: string | null
  level?: number | null
  atk?: number | null
  def?: number | null
  tcgDate?: string | null
}

function seedCards(db: TestDb, cards: CardSeed[]) {
  const now = new Date()
  db.insert(schema.catalogCard).values(cards.map(card => ({
    id: card.id,
    name: card.name,
    type: card.type,
    desc: card.desc ?? `${card.name} description`,
    attribute: card.attribute ?? null,
    race: card.race ?? null,
    level: card.level ?? null,
    atk: card.atk ?? null,
    def: card.def ?? null,
    tcgDate: card.tcgDate ?? null,
    syncedAt: now,
  }))).run()
}

// Mirrors the aggregation/breakdown query logic that lives inline in
// `server/api/inventory/search/index.get.ts`, built on top of the two
// importable, pure/HTTP-free helpers (`parseInventorySearchQuery` +
// `buildInventorySearchWhere`) that the endpoint itself uses. Kept in the
// test file (not extracted into a new server helper) so we exercise the
// same query shape the endpoint runs without spinning up an HTTP server.
function runInventorySearch(db: TestDb, userId: string, rawQuery: Record<string, unknown>) {
  const filters = parseInventorySearchQuery(rawQuery)

  if (filters.collectionId && filters.collectionId !== UNASSIGNED_COLLECTION_ID) {
    assertCollectionOwnedByUser(db, userId, filters.collectionId)
  }

  const where = buildInventorySearchWhere(userId, filters)
  const totalQuantitySql = sql<number>`sum(${schema.ownedCard.quantity})`

  function buildOrderBy(sort: InventorySearchSort): SQL[] {
    switch (sort) {
      case '-name':
        return [desc(schema.catalogCard.name)]
      case 'quantity':
        return [desc(totalQuantitySql), asc(schema.catalogCard.name)]
      case 'newest':
        return [desc(schema.catalogCard.tcgDate)]
      case 'name':
      default:
        return [asc(schema.catalogCard.name)]
    }
  }

  const pageRows = db
    .select({
      catalogCardId: schema.ownedCard.catalogCardId,
      name: schema.catalogCard.name,
      type: schema.catalogCard.type,
      totalQuantity: totalQuantitySql,
    })
    .from(schema.ownedCard)
    .innerJoin(schema.catalogCard, eq(schema.ownedCard.catalogCardId, schema.catalogCard.id))
    .where(where)
    .groupBy(schema.ownedCard.catalogCardId)
    .orderBy(...buildOrderBy(filters.sort))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize)
    .all()

  const total = db
    .select({ count: sql<number>`count(distinct ${schema.ownedCard.catalogCardId})` })
    .from(schema.ownedCard)
    .innerJoin(schema.catalogCard, eq(schema.ownedCard.catalogCardId, schema.catalogCard.id))
    .where(where)
    .get()?.count ?? 0

  const catalogCardIds = pageRows.map(row => row.catalogCardId)
  if (catalogCardIds.length === 0) {
    return { items: [], total, page: filters.page, pageSize: filters.pageSize }
  }

  const breakdownRows = db
    .select({
      catalogCardId: schema.ownedCard.catalogCardId,
      collectionId: schema.ownedCard.collectionId,
      collectionName: schema.collection.name,
      quantity: sql<number>`sum(${schema.ownedCard.quantity})`,
    })
    .from(schema.ownedCard)
    .innerJoin(schema.catalogCard, eq(schema.ownedCard.catalogCardId, schema.catalogCard.id))
    .leftJoin(schema.collection, eq(schema.ownedCard.collectionId, schema.collection.id))
    .where(and(where, inArray(schema.ownedCard.catalogCardId, catalogCardIds)))
    .groupBy(schema.ownedCard.catalogCardId, schema.ownedCard.collectionId)
    .all()

  const breakdownByCardId = new Map<
    number,
    Array<{ collectionId: string | null, collectionName: string | null, quantity: number }>
  >()
  for (const row of breakdownRows) {
    const list = breakdownByCardId.get(row.catalogCardId) ?? []
    list.push({ collectionId: row.collectionId, collectionName: row.collectionName, quantity: row.quantity })
    breakdownByCardId.set(row.catalogCardId, list)
  }

  const items = pageRows.map(row => ({
    catalogCardId: row.catalogCardId,
    name: row.name,
    type: row.type,
    totalQuantity: row.totalQuantity,
    collectionBreakdown: breakdownByCardId.get(row.catalogCardId) ?? [],
  }))

  return { items, total, page: filters.page, pageSize: filters.pageSize }
}

// Mirrors `server/api/inventory/search/facets.get.ts` — distinct owned
// catalog/ownership values, scoped to the user.
function getFacets(db: TestDb, userId: string) {
  function unique(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))).sort()
  }

  const catalogRows = db
    .selectDistinct({
      type: schema.catalogCard.type,
      attribute: schema.catalogCard.attribute,
      race: schema.catalogCard.race,
      level: schema.catalogCard.level,
    })
    .from(schema.ownedCard)
    .innerJoin(schema.catalogCard, eq(schema.ownedCard.catalogCardId, schema.catalogCard.id))
    .where(eq(schema.ownedCard.userId, userId))
    .all()

  const ownershipRows = db
    .selectDistinct({
      language: schema.ownedCard.language,
      condition: schema.ownedCard.condition,
      edition: schema.ownedCard.edition,
    })
    .from(schema.ownedCard)
    .where(eq(schema.ownedCard.userId, userId))
    .all()

  return {
    types: unique(catalogRows.map(r => r.type)),
    attributes: unique(catalogRows.map(r => r.attribute)),
    races: unique(catalogRows.map(r => r.race)),
    levels: Array.from(new Set(catalogRows.map(r => r.level).filter((l): l is number => l !== null))).sort((a, b) => a - b),
    languages: unique(ownershipRows.map(r => r.language)),
    conditions: unique(ownershipRows.map(r => r.condition)),
    editions: unique(ownershipRows.map(r => r.edition)),
  }
}

describe('parseInventorySearchQuery', () => {
  it('clamps paging and drops invalid enum/level values', () => {
    const filters = parseInventorySearchQuery({
      page: '0',
      pageSize: '999',
      condition: 'bogus',
      level: 'abc',
    })

    expect(filters.page).toBe(1)
    expect(filters.pageSize).toBe(60)
    expect(filters.condition).toEqual([])
    expect(filters.level).toEqual([])
  })

  it('parses CSV and repeated multi-value facets', () => {
    const filters = parseInventorySearchQuery({
      type: 'A,B',
      language: ['en', 'de'],
    })

    expect(filters.type).toEqual(['A', 'B'])
    expect(filters.language).toEqual(['en', 'de'])
  })
})

describe('buildInventorySearchWhere', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('escapes LIKE wildcards and scopes results to the given user', async () => {
    seedCards(db, [
      { id: 1, name: 'Sale 50%_off Promo', type: 'Spell Card' },
      { id: 2, name: '500xoff Sale', type: 'Spell Card' },
    ])

    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 1 }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 2 }))
    await addOwnedCard(db, 'user-b', validateInventoryInput({ catalog_card_id: 1 }))

    const filters = parseInventorySearchQuery({ q: '50%_off' })
    const where = buildInventorySearchWhere('user-a', filters)

    const rows = db
      .select({ catalogCardId: schema.ownedCard.catalogCardId, userId: schema.ownedCard.userId })
      .from(schema.ownedCard)
      .innerJoin(schema.catalogCard, eq(schema.ownedCard.catalogCardId, schema.catalogCard.id))
      .where(where)
      .all()

    // Only the literally-matching card (1), only for user-a: `%`/`_` are
    // escaped (card 2 would incorrectly match if they were treated as
    // wildcards), and user-b's copy of card 1 is excluded by the user scope.
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ catalogCardId: 1, userId: 'user-a' })
  })
})

describe('inventory search aggregation (in-memory db)', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('aggregates owned rows by catalog card with total quantity', async () => {
    seedCards(db, [{ id: 46986414, name: 'Dark Magician', type: 'Normal Monster' }])
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 3,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      language: 'de',
      quantity: 2,
    }))

    const result = runInventorySearch(db, 'user-a', {})

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ catalogCardId: 46986414, totalQuantity: 5 })
  })

  it('produces a correct per-collection breakdown', async () => {
    seedCards(db, [{ id: 46986414, name: 'Dark Magician', type: 'Normal Monster' }])
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 3,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      language: 'de',
      quantity: 2,
    }))

    const result = runInventorySearch(db, 'user-a', {})

    const breakdown = result.items[0]!.collectionBreakdown
    expect(breakdown).toHaveLength(2)
    expect(breakdown).toEqual(expect.arrayContaining([
      { collectionId: box1.id, collectionName: 'Box 1', quantity: 3 },
      { collectionId: null, collectionName: null, quantity: 2 },
    ]))
  })

  it('filters by catalog facet (type)', async () => {
    seedCards(db, [
      { id: 46986414, name: 'Dark Magician', type: 'Normal Monster' },
      { id: 55144522, name: 'Pot of Greed', type: 'Spell Card' },
    ])
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 46986414 }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 55144522 }))

    const result = runInventorySearch(db, 'user-a', { type: 'Spell Card' })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ catalogCardId: 55144522, type: 'Spell Card' })
  })

  it('filters by ownership facet (condition)', async () => {
    seedCards(db, [{ id: 46986414, name: 'Dark Magician', type: 'Normal Monster' }])

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      condition: 'near_mint',
      quantity: 2,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      condition: 'played',
      quantity: 5,
    }))

    const result = runInventorySearch(db, 'user-a', { condition: 'near_mint' })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ catalogCardId: 46986414, totalQuantity: 2 })
  })

  it('collectionId filters which cards qualify but keeps the full breakdown', async () => {
    seedCards(db, [{ id: 46986414, name: 'Dark Magician', type: 'Normal Monster' }])
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 3,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      language: 'de',
      quantity: 2,
    }))

    const result = runInventorySearch(db, 'user-a', { collectionId: box1.id })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.totalQuantity).toBe(5)
    expect(result.items[0]!.collectionBreakdown).toHaveLength(2)
  })

  it('collectionId=__none__ selects only cards with unassigned copies', async () => {
    seedCards(db, [
      { id: 46986414, name: 'Dark Magician', type: 'Normal Monster' },
      { id: 55144522, name: 'Pot of Greed', type: 'Spell Card' },
    ])
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 1,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 55144522,
      quantity: 4,
    }))

    const result = runInventorySearch(db, 'user-a', { collectionId: UNASSIGNED_COLLECTION_ID })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ catalogCardId: 55144522 })
  })

  it('matches names case-insensitively with wildcards escaped', async () => {
    seedCards(db, [{ id: 89631139, name: 'Blue-Eyes White Dragon', type: 'Normal Monster' }])
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 89631139 }))

    const result = runInventorySearch(db, 'user-a', { q: 'blue' })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ catalogCardId: 89631139 })
  })

  it('sorts by quantity desc and by newest (tcgDate) desc', async () => {
    seedCards(db, [
      { id: 1, name: 'Old Small Card', type: 'Normal Monster', tcgDate: '1999-01-01' },
      { id: 2, name: 'New Big Card', type: 'Normal Monster', tcgDate: '2020-01-01' },
    ])
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 1, quantity: 1 }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 2, quantity: 9 }))

    const byQuantity = runInventorySearch(db, 'user-a', { sort: 'quantity' })
    expect(byQuantity.items.map(item => item.catalogCardId)).toEqual([2, 1])

    const byNewest = runInventorySearch(db, 'user-a', { sort: 'newest' })
    expect(byNewest.items.map(item => item.catalogCardId)).toEqual([2, 1])
  })

  it('paginates over the aggregated results', async () => {
    const cards: CardSeed[] = Array.from({ length: 30 }, (_, i) => ({
      id: 900000 + i,
      name: `Card ${String(i).padStart(2, '0')}`,
      type: 'Normal Monster',
    }))
    seedCards(db, cards)
    for (const card of cards) {
      await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: card.id }))
    }

    const result = runInventorySearch(db, 'user-a', { pageSize: '10', page: '2' })

    expect(result.items.length).toBeLessThanOrEqual(10)
    expect(result.total).toBe(30)
    expect(result.page).toBe(2)
    expect(result.pageSize).toBe(10)
  })

  it('scopes results to the searching user (ownership boundary)', async () => {
    seedCards(db, [
      { id: 46986414, name: 'Dark Magician', type: 'Normal Monster' },
      { id: 55144522, name: 'Pot of Greed', type: 'Spell Card' },
    ])
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 46986414 }))
    await addOwnedCard(db, 'user-b', validateInventoryInput({ catalog_card_id: 55144522 }))

    const result = runInventorySearch(db, 'user-a', {})

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ catalogCardId: 46986414 })
  })

  it('rejects a collectionId that does not belong to the searching user', async () => {
    seedCards(db, [{ id: 46986414, name: 'Dark Magician', type: 'Normal Monster' }])
    const bsBox = await createCollection(db, 'user-b', { name: "B's Box", description: null })

    expect(() => runInventorySearch(db, 'user-a', { collectionId: bsBox.id }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => runInventorySearch(db, 'user-a', { collectionId: 'nonexistent' }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('inventory search facets', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('returns only distinct owned values, scoped to the user', async () => {
    seedCards(db, [
      { id: 46986414, name: 'Dark Magician', type: 'Normal Monster', attribute: 'DARK', race: 'Spellcaster', level: 7 },
      { id: 55144522, name: 'Pot of Greed', type: 'Spell Card' },
    ])
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      language: 'en',
      condition: 'near_mint',
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      language: 'de',
      condition: 'near_mint',
    }))
    // Different user — must not leak into user-a's facets.
    await addOwnedCard(db, 'user-b', validateInventoryInput({ catalog_card_id: 55144522, language: 'ja' }))

    const facets = getFacets(db, 'user-a')

    expect(facets.types).toEqual(['Normal Monster'])
    expect(facets.attributes).toEqual(['DARK'])
    expect(facets.races).toEqual(['Spellcaster'])
    expect(facets.levels).toEqual([7])
    expect(facets.languages.sort()).toEqual(['de', 'en'])
    expect(facets.conditions).toEqual(['near_mint'])
  })

  it('returns empty arrays for a user with no owned cards', () => {
    seedCards(db, [{ id: 46986414, name: 'Dark Magician', type: 'Normal Monster' }])

    const facets = getFacets(db, 'user-a')

    expect(facets).toEqual({
      types: [],
      attributes: [],
      races: [],
      levels: [],
      languages: [],
      conditions: [],
      editions: [],
    })
  })
})

describe('inventory search auth', () => {
  it('rejects unauthenticated requests with 401', async () => {
    vi.resetModules()
    vi.doMock('../../server/utils/auth', () => ({
      useAuth: () => ({
        api: {
          getSession: async () => null,
        },
      }),
    }))

    const { requireUser } = await import('../../server/utils/session')
    const fakeEvent = { headers: new Headers() } as unknown as Parameters<typeof requireUser>[0]

    await expect(requireUser(fakeEvent)).rejects.toMatchObject({ statusCode: 401 })

    vi.doUnmock('../../server/utils/auth')
    vi.resetModules()
  })
})
