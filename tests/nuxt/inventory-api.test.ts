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
  updateOwnedCard,
  validateInventoryInput,
} from '../../server/utils/inventory'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

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
    expect(validateInventoryInput({ catalog_card_id: '46986414' })).toMatchObject({
      catalogCardId: 46986414,
      printingId: null,
      quantity: 1,
      language: 'en',
      condition: 'near_mint',
      edition: 'unlimited',
      note: null,
    })
  })

  it('rejects invalid quantity, missing card id, and unsupported language', () => {
    expect(() => validateInventoryInput({ catalog_card_id: 46986414, quantity: 0 })).toThrow()
    expect(() => validateInventoryInput({ quantity: 1 })).toThrow()
    expect(() => validateInventoryInput({ catalog_card_id: 46986414, language: 'xx' })).toThrow()
  })
})

describe('inventory persistence helpers', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedCatalog(db)
  })

  it('adds and upserts owned cards by the ownership tuple', async () => {
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      printing_id: 'LOB-005',
      quantity: 1,
      language: 'en',
    }))
    const updated = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      printing_id: 'LOB-005',
      quantity: 2,
      language: 'en',
    }))

    const rows = db.select().from(schema.ownedCard).all()
    expect(rows).toHaveLength(1)
    expect(updated.quantity).toBe(3)
  })

  it('rejects unknown catalog cards and printings', async () => {
    await expect(addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 1,
    }))).rejects.toMatchObject({ statusCode: 400 })

    await expect(addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      printing_id: 'NOPE-001',
    }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lists only the current user inventory with catalog display data', async () => {
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      printing_id: 'LOB-005',
      quantity: 2,
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
      setName: 'Legend of Blue Eyes White Dragon',
      quantity: 2,
    })
  })

  it('updates own rows, merges tuple collisions, and rejects quantity below one', async () => {
    const first = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      language: 'en',
      condition: 'near_mint',
      quantity: 1,
    }))
    const second = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      language: 'de',
      condition: 'near_mint',
      quantity: 2,
    }))

    await expect(updateOwnedCard(db, 'user-a', first.id, { quantity: 0 })).rejects.toMatchObject({ statusCode: 400 })

    const merged = await updateOwnedCard(db, 'user-a', first.id, { language: 'de' })
    expect(merged.id).toBe(second.id)
    expect(merged.quantity).toBe(3)
    expect(db.select().from(schema.ownedCard).where(eq(schema.ownedCard.userId, 'user-a')).all()).toHaveLength(1)
  })

  it('returns 404 when patching or deleting another user row', async () => {
    const owned = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      quantity: 1,
    }))

    await expect(updateOwnedCard(db, 'user-b', owned.id, { quantity: 2 })).rejects.toMatchObject({ statusCode: 404 })
    await expect(deleteOwnedCard(db, 'user-b', owned.id)).rejects.toMatchObject({ statusCode: 404 })

    await deleteOwnedCard(db, 'user-a', owned.id)
    expect(db.select().from(schema.ownedCard).all()).toHaveLength(0)
  })
})
