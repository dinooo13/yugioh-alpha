import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  createCollection,
  deleteCollection,
  listCollections,
  requireCollectionOwnedByUser,
  updateCollection,
  validateCollectionInput,
  validateCollectionUpdateInput,
} from '../../server/utils/collections'
import { addOwnedCard, listOwnedCards, validateInventoryInput } from '../../server/utils/inventory'

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
}

describe('collection validation', () => {
  it('normalizes valid collection input', () => {
    expect(validateCollectionInput({ name: '  Box 1  ' })).toEqual({
      name: 'Box 1',
      description: null,
    })
    expect(validateCollectionInput({ name: 'Binder', description: '  My trade binder  ' })).toEqual({
      name: 'Binder',
      description: 'My trade binder',
    })
  })

  it('rejects empty/whitespace names and overlong fields', () => {
    expect(() => validateCollectionInput({ name: '' })).toThrow()
    expect(() => validateCollectionInput({ name: '   ' })).toThrow()
    expect(() => validateCollectionInput({ name: 'a'.repeat(61) })).toThrow()
    expect(() => validateCollectionInput({ name: 'Box 1', description: 'x'.repeat(501) })).toThrow()
  })

  it('partial update only validates provided fields', () => {
    expect(validateCollectionUpdateInput({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
    expect(validateCollectionUpdateInput({})).toEqual({})
    expect(() => validateCollectionUpdateInput({ name: '' })).toThrow()
  })
})

describe('collection persistence', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('creates a collection with zero card count', async () => {
    const created = await createCollection(db, 'user-a', { name: 'Box 1', description: null })

    expect(created).toMatchObject({ name: 'Box 1', cardCount: 0 })
    const rows = db.select().from(schema.collection).where(eq(schema.collection.userId, 'user-a')).all()
    expect(rows).toHaveLength(1)
  })

  it('rejects a duplicate name (case-insensitive) for the same user', async () => {
    await createCollection(db, 'user-a', { name: 'Box 1', description: null })

    await expect(createCollection(db, 'user-a', { name: 'box 1', description: null }))
      .rejects.toMatchObject({ statusCode: 409 })

    // Same name is fine for a different user.
    await expect(createCollection(db, 'user-b', { name: 'Box 1', description: null })).resolves.toBeTruthy()
  })

  it('lists a user collections with SUM(quantity) counts and allCount', async () => {
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    await createCollection(db, 'user-a', { name: 'Binder', description: null })

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 2,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 55144522,
      quantity: 3,
    }))

    const result = listCollections(db, 'user-a')

    const boxEntry = result.items.find(item => item.id === box1.id)
    const binderEntry = result.items.find(item => item.name === 'Binder')
    expect(boxEntry?.cardCount).toBe(2)
    expect(binderEntry?.cardCount).toBe(0)
    expect(result.allCount).toBe(5)
  })

  it('scopes the collection list to the current user', async () => {
    await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    await createCollection(db, 'user-b', { name: 'Box 1', description: null })

    const result = listCollections(db, 'user-a')
    expect(result.items).toHaveLength(1)
  })

  it('renames a collection and rejects a name collision', async () => {
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    await createCollection(db, 'user-a', { name: 'Binder', description: null })

    const renamed = await updateCollection(db, 'user-a', box1.id, { name: 'Box One' })
    expect(renamed.name).toBe('Box One')

    await expect(updateCollection(db, 'user-a', box1.id, { name: 'Binder' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('returns 404 patching or deleting another user collection', async () => {
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })

    await expect(updateCollection(db, 'user-b', box1.id, { name: 'Stolen' }))
      .rejects.toMatchObject({ statusCode: 404 })
    await expect(deleteCollection(db, 'user-b', box1.id))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('unassigns owned cards on delete instead of destroying them', async () => {
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    const owned = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 4,
    }))

    await deleteCollection(db, 'user-a', box1.id)

    const rows = db.select().from(schema.ownedCard).where(eq(schema.ownedCard.id, owned.id)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.collectionId).toBeNull()

    // Unassigned rows still show up in the unfiltered ("Alle Karten") list.
    const list = listOwnedCards(db, 'user-a')
    expect(list.items.some(item => item.id === owned.id)).toBe(true)
  })

  it('filters the inventory list by collectionId', async () => {
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    const box2 = await createCollection(db, 'user-a', { name: 'Box 2', description: null })

    const inBox1 = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 1,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 55144522,
      collection_id: box2.id,
      quantity: 1,
    }))
    const unassigned = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      language: 'de',
      quantity: 1,
    }))

    const filtered = listOwnedCards(db, 'user-a', { collectionId: box1.id })
    expect(filtered.items.map(item => item.id)).toEqual([inBox1.id])

    const all = listOwnedCards(db, 'user-a')
    expect(all.items.map(item => item.id).sort()).toEqual(
      [inBox1.id, unassigned.id, all.items.find(i => i.catalogCardId === 55144522)!.id].sort(),
    )
  })

  it('adding the same card to two collections creates two rows; re-adding to the same one merges', async () => {
    const box1 = await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    const box2 = await createCollection(db, 'user-a', { name: 'Box 2', description: null })

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 1,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box2.id,
      quantity: 1,
    }))

    let rows = db.select().from(schema.ownedCard).where(eq(schema.ownedCard.userId, 'user-a')).all()
    expect(rows).toHaveLength(2)

    const merged = await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
      quantity: 2,
    }))

    rows = db.select().from(schema.ownedCard).where(eq(schema.ownedCard.userId, 'user-a')).all()
    expect(rows).toHaveLength(2)
    expect(merged.quantity).toBe(3)
  })

  it('rejects a collection_id that does not belong to the user', async () => {
    const box1 = await createCollection(db, 'user-b', { name: "B's Box", description: null })

    await expect(addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: 46986414,
      collection_id: box1.id,
    }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('requireCollectionOwnedByUser throws 404 for a foreign or missing collection', async () => {
    const box1 = await createCollection(db, 'user-b', { name: "B's Box", description: null })

    expect(() => requireCollectionOwnedByUser(db, 'user-a', box1.id)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => requireCollectionOwnedByUser(db, 'user-a', 'nonexistent')).toThrow(expect.objectContaining({ statusCode: 404 }))
  })
})
