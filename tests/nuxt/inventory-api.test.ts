import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  addOwnedCard,
  deleteOwnedCard,
  listOwnedCards,
  parseInventoryListQuery,
  searchCatalogCards,
  updateOwnedCard,
  validateInventoryInput,
  validateInventoryUpdateInput,
} from '../../server/utils/inventory'
import { seedGermanNames } from './fixtures/german-names'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

const COLLECTOR_KEYS = ['printingId', 'language', 'condition', 'edition']

function seedCatalog(db: TestDb) {
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

  db.insert(schema.catalogCard).values([
    {
      id: 46986414,
      name: 'Dark Magician',
      type: 'Normal Monster',
      desc: 'The ultimate wizard.',
      syncedAt: now,
    },
    {
      id: 55144522,
      name: 'Pot of Greed',
      type: 'Spell Card',
      desc: 'Draw two cards.',
      syncedAt: now,
    },
  ]).run()

  db.insert(schema.catalogSet).values({
    id: 'legend-of-blue-eyes-white-dragon',
    name: 'Legend of Blue Eyes White Dragon',
  }).run()

  db.insert(schema.catalogPrinting).values({
    id: 'LOB-005',
    cardId: 46986414,
    setId: 'legend-of-blue-eyes-white-dragon',
    setCode: 'LOB-005',
    rarity: 'Ultra Rare',
  }).run()

  db.insert(schema.catalogCardImage).values({
    id: 46986414,
    cardId: 46986414,
    imageUrl: 'https://images.example/dm.jpg',
    imageUrlSmall: 'https://images.example/dm-small.jpg',
    imageUrlCropped: 'https://images.example/dm-crop.jpg',
  }).run()
}

describe('inventory validation', () => {
  it('normalizes valid inventory input with defaults', () => {
    expect(validateInventoryInput({ catalog_card_id: '46986414' })).toEqual({
      catalogCardId: 46986414,
      collectionId: null,
      quantity: 1,
      note: null,
    })
  })

  it('ignores the former collector fields (ADR 0017)', () => {
    const input = validateInventoryInput({
      catalog_card_id: 46986414,
      printing_id: 'NOPE-001',
      printingId: 'LOB-005',
      language: 'xx',
      condition: 'played',
      edition: 'first',
      quantity: 2,
    })
    expect(input).toEqual({ catalogCardId: 46986414, collectionId: null, quantity: 2, note: null })

    const patch = validateInventoryUpdateInput({ printing_id: 'LOB-005', language: 'de', condition: 'played', edition: 'first', quantity: 3 })
    expect(patch).toEqual({ quantity: 3 })
  })

  it('rejects invalid quantity and a missing card id', () => {
    expect(() => validateInventoryInput({ catalog_card_id: 46986414, quantity: 0 })).toThrow()
    expect(() => validateInventoryInput({ quantity: 1 })).toThrow()
  })

  it('gives the user-typed quantity errors a translatable code', () => {
    expect(() => validateInventoryInput({ catalog_card_id: 46986414, quantity: 0 }))
      .toThrow(expect.objectContaining({ statusCode: 400, data: expect.objectContaining({ code: 'quantity_invalid' }) }))
    expect(() => validateInventoryInput({ catalog_card_id: 46986414, quantity: 1000 }))
      .toThrow(expect.objectContaining({ statusCode: 400, data: { code: 'quantity_too_large', params: { max: 999 } } }))
  })

  it('parses the list query, ignoring a catalogCardId that is not a positive integer', () => {
    expect(parseInventoryListQuery({ q: 'dark', page: '2', pageSize: '10', collectionId: '__none__', catalogCardId: '46986414' })).toEqual({
      q: 'dark',
      page: 2,
      pageSize: 10,
      collectionId: '__none__',
      catalogCardId: 46986414,
    })
    for (const catalogCardId of ['abc', '0', '-3', '1.5', '']) {
      expect(parseInventoryListQuery({ catalogCardId }).catalogCardId).toBeUndefined()
    }
    expect(parseInventoryListQuery({ collectionId: '' }).collectionId).toBeUndefined()
  })
})

describe('inventory persistence helpers', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedCatalog(db)
  })

  it('adds and upserts owned cards by card and collection only (ADR 0017)', async () => {
    const first = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      printing_id: 'LOB-005',
      quantity: 1,
      language: 'en',
    }))
    // A different printing and language used to be a separate row; now it merges.
    const updated = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      quantity: 2,
      language: 'de',
      edition: 'first',
    }))

    const rows = db.select().from(schema.ownedCard).all()
    expect(rows).toHaveLength(1)
    expect(updated.id).toBe(first.id)
    expect(updated.quantity).toBe(3)
    expect(rows[0]).toMatchObject({ printingId: null, language: 'en', condition: 'near_mint', edition: 'unlimited' })
  })

  it('returns owned cards without the collector columns', async () => {
    const created = await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 46986414, note: 'Binder' }))
    const patched = await updateOwnedCard(db, 'user-a', created.id, validateInventoryUpdateInput({ quantity: 4 }))

    for (const row of [created, patched]) {
      for (const key of COLLECTOR_KEYS) {
        expect(row).not.toHaveProperty(key)
      }
      expect(row).toMatchObject({ catalogCardId: 46986414, note: 'Binder' })
    }
    expect(patched.quantity).toBe(4)
  })

  it('rejects unknown catalog cards', async () => {
    await expect(addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 1,
    }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lists only the current user inventory with catalog display data', async () => {
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      quantity: 2,
      note: 'Binder',
    }))
    await addOwnedCard(db, 'user-b', validateInventoryInput({
      catalog_card_id: 55144522,
      quantity: 1,
    }))

    const result = listOwnedCards(db, 'user-a')

    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({
      cardName: 'Dark Magician',
      imageUrlSmall: 'https://images.example/dm-small.jpg',
      quantity: 2,
      note: 'Binder',
    })
    for (const key of [...COLLECTOR_KEYS, 'setName', 'rarity']) {
      expect(result.items[0]).not.toHaveProperty(key)
    }
  })

  describe('list filters', () => {
    beforeEach(async () => {
      const now = new Date()
      db.insert(schema.collection).values({ id: 'col-1', userId: 'user-a', name: 'Box 1', createdAt: now, updatedAt: now }).run()
      // Dark Magician: one row in Box 1, one without a collection.
      await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 46986414, collection_id: 'col-1', quantity: 2 }))
      await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 46986414, quantity: 1 }))
      // Pot of Greed: in Box 1 only.
      await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: 55144522, collection_id: 'col-1', quantity: 1 }))
      // Another user's unassigned row never leaks in.
      await addOwnedCard(db, 'user-b', validateInventoryInput({ catalog_card_id: 55144522, quantity: 1 }))
    })

    function rows(result: ReturnType<typeof listOwnedCards>) {
      return result.items.map(item => `${item.cardName}/${item.collectionId ?? '-'}`).sort()
    }

    it('searches English and German names, wildcards literal (ADR 0015)', () => {
      seedGermanNames(db, { 46986414: 'Dunkler Magier', 55144522: 'Topf der Gier' })

      expect(rows(listOwnedCards(db, 'user-a', { q: 'dark' }))).toEqual(['Dark Magician/-', 'Dark Magician/col-1'])
      expect(rows(listOwnedCards(db, 'user-a', { q: 'TOPF' }))).toEqual(['Pot of Greed/col-1'])
      expect(listOwnedCards(db, 'user-a', { q: '%' }).total).toBe(0)
    })

    it('finds catalog cards for the picker by German name or passcode', () => {
      seedGermanNames(db, { 46986414: 'Dunkler Magier' })

      expect(searchCatalogCards(db, 'dunkler').map(card => card.name)).toEqual(['Dark Magician'])
      expect(searchCatalogCards(db, '5514452').map(card => card.name)).toEqual(['Pot of Greed'])
      expect(searchCatalogCards(db, '_')).toEqual([])
    })

    it('returns picker cards without printings (#75)', () => {
      const [card] = searchCatalogCards(db, 'Dark Magician')
      expect(Object.keys(card!).sort()).toEqual(['id', 'imageUrlSmall', 'name', 'nameDe', 'type'])
    })

    it('leaves retired cards out of the picker (ADR 0019)', () => {
      db.insert(schema.catalogCard).values({
        id: 101402024,
        name: 'Dark Magician',
        type: 'Normal Monster',
        desc: 'Placeholder.',
        syncedAt: new Date(),
        retiredAt: new Date(),
        replacedById: 46986414,
      }).run()

      expect(searchCatalogCards(db, 'Dark Magician').map(card => card.id)).toEqual([46986414])
      expect(searchCatalogCards(db, '101402024')).toEqual([])
      expect(searchCatalogCards(db).map(card => card.id)).not.toContain(101402024)
    })

    it('lists only unassigned rows for "__none__"', () => {
      const result = listOwnedCards(db, 'user-a', { collectionId: '__none__' })
      expect(result.total).toBe(1)
      expect(rows(result)).toEqual(['Dark Magician/-'])
    })

    it('filters rows by collection (row-level, unlike the aggregated search)', () => {
      expect(rows(listOwnedCards(db, 'user-a', { collectionId: 'col-1' }))).toEqual(['Dark Magician/col-1', 'Pot of Greed/col-1'])
    })

    it('filters rows by catalog card, alone and combined with a collection', () => {
      expect(rows(listOwnedCards(db, 'user-a', { catalogCardId: 46986414 }))).toEqual(['Dark Magician/-', 'Dark Magician/col-1'])
      expect(rows(listOwnedCards(db, 'user-a', { catalogCardId: 46986414, collectionId: 'col-1' }))).toEqual(['Dark Magician/col-1'])
      expect(rows(listOwnedCards(db, 'user-a', { catalogCardId: 46986414, collectionId: '__none__' }))).toEqual(['Dark Magician/-'])
      expect(listOwnedCards(db, 'user-a', { catalogCardId: 55144522, collectionId: '__none__' }).total).toBe(0)
    })
  })

  it('updates own rows, merges collisions, and rejects quantity below one', async () => {
    const now = new Date()
    db.insert(schema.collection).values({ id: 'col-1', userId: 'user-a', name: 'Box 1', createdAt: now, updatedAt: now }).run()
    const first = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: 'col-1',
      quantity: 1,
    }))
    const second = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      quantity: 2,
    }))

    await expect(updateOwnedCard(db, 'user-a', first.id, { quantity: 0 })).rejects.toMatchObject({ statusCode: 400 })

    // A language change is ignored now; moving the stack out of Box 1 collides and merges.
    const unchanged = await updateOwnedCard(db, 'user-a', first.id, validateInventoryUpdateInput({ language: 'de' }))
    expect(unchanged.id).toBe(first.id)

    const merged = await updateOwnedCard(db, 'user-a', first.id, validateInventoryUpdateInput({ collectionId: null }))
    expect(merged.id).toBe(second.id)
    expect(merged.quantity).toBe(3)
    expect(db.select().from(schema.ownedCard).where(eq(schema.ownedCard.userId, 'user-a')).all()).toHaveLength(1)
  })

  it('returns 404 when patching or deleting another user row', async () => {
    const owned = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      quantity: 1,
    }))

    await expect(updateOwnedCard(db, 'user-b', owned.id, { quantity: 2 }))
      .rejects.toMatchObject({ statusCode: 404, data: { code: 'owned_card_not_found' } })
    await expect(deleteOwnedCard(db, 'user-b', owned.id))
      .rejects.toMatchObject({ statusCode: 404, data: { code: 'owned_card_not_found' } })

    await deleteOwnedCard(db, 'user-a', owned.id)
    expect(db.select().from(schema.ownedCard).all()).toHaveLength(0)
  })
})
