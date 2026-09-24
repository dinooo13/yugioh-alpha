import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { addOwnedCard, validateInventoryInput } from '../../server/utils/inventory'
import {
  addWishlistItem,
  canViewWishlist,
  listPublicWishlist,
  listWishlist,
  MAX_WISHLIST_QUANTITY,
  removeWishlistItem,
  removeWishlistItemByCard,
  updateWishlistItem,
  validateWishlistInput,
  wishlistCardIds,
} from '../../server/utils/wishlist'
import { seedGermanNames } from './fixtures/german-names'

const CARD = {
  darkMagician: 46986414,
  potOfGreed: 55144522,
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
    { id: CARD.darkMagician, name: 'Dark Magician', type: 'Normal Monster', desc: 'The ultimate wizard.', syncedAt: now },
    { id: CARD.potOfGreed, name: 'Pot of Greed', type: 'Spell Card', desc: 'Draw two cards.', syncedAt: now },
  ]).run()
}

describe('validateWishlistInput', () => {
  it('accepts catalog_card_id and catalogCardId, defaulting quantity/note', () => {
    expect(validateWishlistInput({ catalog_card_id: CARD.darkMagician })).toEqual({
      catalogCardId: CARD.darkMagician,
      quantity: 1,
      note: null,
    })
    expect(validateWishlistInput({ catalogCardId: CARD.darkMagician, quantity: 2, note: 'DE 1st ed.' })).toEqual({
      catalogCardId: CARD.darkMagician,
      quantity: 2,
      note: 'DE 1st ed.',
    })
  })

  it('rejects quantity 0 and 100', () => {
    expect(() => validateWishlistInput({ catalogCardId: CARD.darkMagician, quantity: 0 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateWishlistInput({ catalogCardId: CARD.darkMagician, quantity: MAX_WISHLIST_QUANTITY + 1 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects a note over 200 characters', () => {
    expect(() => validateWishlistInput({ catalogCardId: CARD.darkMagician, note: 'a'.repeat(201) }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects a missing catalog_card_id', () => {
    expect(() => validateWishlistInput({})).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateWishlistInput({ catalogCardId: 0 })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('addWishlistItem', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('rejects an unknown catalog card id', () => {
    expect(() => addWishlistItem(db, 'user-a', validateWishlistInput({ catalogCardId: 999999999 })))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('upserts on (userId, catalogCardId): a second add replaces, does not sum, quantity', () => {
    addWishlistItem(db, 'user-a', validateWishlistInput({ catalogCardId: CARD.darkMagician, quantity: 1 }))
    const second = addWishlistItem(db, 'user-a', validateWishlistInput({ catalogCardId: CARD.darkMagician, quantity: 2 }))

    expect(second.quantity).toBe(2)
    const rows = db.select().from(schema.wishlistItem).all()
    expect(rows).toHaveLength(1)
  })
})

describe('listWishlist / listPublicWishlist', () => {
  let db: TestDb

  beforeEach(async () => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    addWishlistItem(db, 'user-a', validateWishlistInput({
      catalogCardId: CARD.darkMagician,
      quantity: 3,
      note: 'Bitte 1st edition',
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: CARD.darkMagician, quantity: 1 }))
  })

  it('listWishlist includes owned copies from the inventory', () => {
    const page = listWishlist(db, 'user-a')
    expect(page.items[0]).toMatchObject({ catalogCardId: CARD.darkMagician, quantity: 3, owned: 1 })
  })

  it('listWishlist finds items by their German name (ADR 0015)', () => {
    seedGermanNames(db, { [CARD.darkMagician]: 'Dunkler Magier' })

    expect(listWishlist(db, 'user-a', { q: 'dunkler mag' }).items.map(item => item.catalogCardId))
      .toEqual([CARD.darkMagician])
    expect(listWishlist(db, 'user-a', { q: 'Topf' }).items).toEqual([])
  })

  it('still lists a retired card, flagged, in every view (ADR 0019)', () => {
    expect(listWishlist(db, 'user-a').items[0]).toMatchObject({ retired: false })
    db.update(schema.catalogCard).set({ retiredAt: new Date() }).run()

    const item = listWishlist(db, 'user-a').items[0]!
    expect(item).toMatchObject({ catalogCardId: CARD.darkMagician, retired: true })
    expect(item).not.toHaveProperty('retiredAt')
    expect(listPublicWishlist(db, 'user-a').items[0]).toMatchObject({ retired: true })
    expect(updateWishlistItem(db, 'user-a', item.id, { quantity: 2 })).toMatchObject({ quantity: 2, retired: true })
    expect(addWishlistItem(db, 'user-a', validateWishlistInput({ catalogCardId: CARD.darkMagician }))).toMatchObject({ retired: true })
  })

  it('listPublicWishlist omits owned but keeps note', () => {
    const page = listPublicWishlist(db, 'user-a')
    expect(page.items[0]).not.toHaveProperty('owned')
    expect(page.items[0]!.note).toBe('Bitte 1st edition')
  })
})

describe('removeWishlistItem / removeWishlistItemByCard', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('404s on a foreign or unknown row', () => {
    const item = addWishlistItem(db, 'user-a', validateWishlistInput({ catalogCardId: CARD.darkMagician }))

    expect(() => removeWishlistItem(db, 'user-b', item.id)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => removeWishlistItem(db, 'user-a', 'nonexistent'))
      .toThrow(expect.objectContaining({ statusCode: 404, data: { code: 'wishlist_item_not_found' } }))
    expect(() => removeWishlistItemByCard(db, 'user-b', CARD.darkMagician)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => removeWishlistItemByCard(db, 'user-a', CARD.potOfGreed)).toThrow(expect.objectContaining({ statusCode: 404 }))
  })

  it('removes the row', () => {
    const item = addWishlistItem(db, 'user-a', validateWishlistInput({ catalogCardId: CARD.darkMagician }))
    removeWishlistItem(db, 'user-a', item.id)

    expect(listWishlist(db, 'user-a').items).toEqual([])
  })
})

describe('wishlistCardIds', () => {
  it('returns exactly the caller ids', () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    addWishlistItem(db, 'user-a', validateWishlistInput({ catalogCardId: CARD.darkMagician }))
    addWishlistItem(db, 'user-b', validateWishlistInput({ catalogCardId: CARD.potOfGreed }))

    expect(wishlistCardIds(db, 'user-a')).toEqual([CARD.darkMagician])
    expect(wishlistCardIds(db, 'user-b')).toEqual([CARD.potOfGreed])
  })
})

// This is the exact gate GET /api/profiles/:handle/wishlist (and the profile
// page's teaser count) run before returning anything to a non-owner — pinned
// here at the util level since it is what stands between a private wishlist
// and a 404 for a stranger.
describe('canViewWishlist', () => {
  it('lets the owner see their own wishlist regardless of visibility', () => {
    expect(canViewWishlist('user-a', 'private', 'user-a')).toBe(true)
    expect(canViewWishlist('user-a', 'public', 'user-a')).toBe(true)
  })

  it('404s (returns false) for anyone else while private, including anonymous', () => {
    expect(canViewWishlist('user-a', 'private', 'user-b')).toBe(false)
    expect(canViewWishlist('user-a', 'private', null)).toBe(false)
  })

  it('lets anyone see a public wishlist, including anonymous', () => {
    expect(canViewWishlist('user-a', 'public', 'user-b')).toBe(true)
    expect(canViewWishlist('user-a', 'public', null)).toBe(true)
  })
})
