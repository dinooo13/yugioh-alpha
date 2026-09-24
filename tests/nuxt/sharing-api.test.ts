import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { createDeck, deleteDeck, upsertDeckCard } from '../../server/utils/decks'
import { createCollection, deleteCollection } from '../../server/utils/collections'
import { addOwnedCard, validateInventoryInput } from '../../server/utils/inventory'
import { ensureProfile, toPublicProfile } from '../../server/utils/profiles'
import {
  addShareGrant,
  generateShareToken,
  listShareGrants,
  removeShareGrant,
  requireViewableCollection,
  requireViewableDeck,
  requireViewableInventory,
  resolveAccess,
  setShareState,
  tokensMatch,
} from '../../server/utils/sharing'
import type { ShareAccessVia, ShareTarget } from '../../server/utils/sharing'
import { buildSharedDeckView, listSharedCollection, listSharedInventory, listVisibleDecks } from '../../server/utils/shared-views'
import type { ShareResourceType, Visibility } from '../../shared/sharing'

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
    { id: 'user-c', name: 'User C', email: 'c@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()

  db.insert(schema.catalogCard).values([
    {
      id: CARD.darkMagician,
      name: 'Dark Magician',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'The ultimate wizard.',
      attribute: 'DARK',
      level: 7,
      syncedAt: now,
    },
    {
      id: CARD.potOfGreed,
      name: 'Pot of Greed',
      type: 'Spell Card',
      frameType: 'spell',
      desc: 'Draw two cards.',
      syncedAt: now,
    },
  ]).run()
}

describe('resolveAccess truth table', () => {
  let db: TestDb
  const ownerId = 'user-a'
  const grantedId = 'user-b'
  const strangerId = 'user-c'
  const resourceId = 'resource-1'
  const storedToken = generateShareToken()

  const RESOURCE_TYPES: ShareResourceType[] = ['deck', 'collection', 'inventory']

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)

    for (const resourceType of RESOURCE_TYPES) {
      db.insert(schema.shareGrant).values({
        id: `grant-${resourceType}`,
        resourceType,
        resourceId,
        ownerUserId: ownerId,
        grantedUserId: grantedId,
        createdAt: new Date(),
      }).run()
    }
  })

  interface Case {
    visibility: Visibility
    viewer: 'owner' | 'granted' | 'stranger' | 'anonymous'
    token: 'none' | 'correct' | 'wrong'
    allowed: boolean
    via: ShareAccessVia | null
  }

  const cases: Case[] = [
    // private: only owner and granted user see it; a token is never honoured.
    { visibility: 'private', viewer: 'owner', token: 'none', allowed: true, via: 'owner' },
    { visibility: 'private', viewer: 'granted', token: 'none', allowed: true, via: 'grant' },
    { visibility: 'private', viewer: 'stranger', token: 'none', allowed: false, via: null },
    { visibility: 'private', viewer: 'stranger', token: 'correct', allowed: false, via: null },
    { visibility: 'private', viewer: 'anonymous', token: 'none', allowed: false, via: null },
    // link: owner, granted user, and a correct token; wrong/missing token fails.
    { visibility: 'link', viewer: 'owner', token: 'none', allowed: true, via: 'owner' },
    { visibility: 'link', viewer: 'granted', token: 'none', allowed: true, via: 'grant' },
    { visibility: 'link', viewer: 'stranger', token: 'correct', allowed: true, via: 'token' },
    { visibility: 'link', viewer: 'stranger', token: 'wrong', allowed: false, via: null },
    { visibility: 'link', viewer: 'stranger', token: 'none', allowed: false, via: null },
    { visibility: 'link', viewer: 'anonymous', token: 'correct', allowed: true, via: 'token' },
    { visibility: 'link', viewer: 'anonymous', token: 'none', allowed: false, via: null },
    // public: everyone, regardless of token; 'public' wins the reported `via`
    // even for a viewer who also holds a grant (evaluation order).
    { visibility: 'public', viewer: 'owner', token: 'none', allowed: true, via: 'owner' },
    { visibility: 'public', viewer: 'granted', token: 'none', allowed: true, via: 'public' },
    { visibility: 'public', viewer: 'stranger', token: 'none', allowed: true, via: 'public' },
    { visibility: 'public', viewer: 'stranger', token: 'wrong', allowed: true, via: 'public' },
    { visibility: 'public', viewer: 'anonymous', token: 'none', allowed: true, via: 'public' },
  ]

  const scenarios = RESOURCE_TYPES.flatMap(resourceType => cases.map(testCase => ({ resourceType, ...testCase })))

  it.each(scenarios)(
    '$resourceType / $visibility / viewer=$viewer / token=$token',
    ({ resourceType, visibility, viewer, token, allowed, via }) => {
      const target: ShareTarget = {
        resourceType,
        resourceId,
        ownerUserId: ownerId,
        visibility,
        shareToken: storedToken,
      }

      const viewerId = viewer === 'owner'
        ? ownerId
        : viewer === 'granted'
          ? grantedId
          : viewer === 'stranger'
            ? strangerId
            : null

      const providedToken = token === 'correct' ? storedToken : token === 'wrong' ? 'wrong-token-value' : undefined

      const access = resolveAccess(db, target, viewerId, providedToken)
      expect(access.allowed).toBe(allowed)
      expect(access.via).toBe(via)
    },
  )
})

describe('tokensMatch', () => {
  it('is null/undefined-safe and length-guarded', () => {
    expect(tokensMatch(null, 'anything')).toBe(false)
    expect(tokensMatch('abc', undefined)).toBe(false)
    expect(tokensMatch('abc', 'abcd')).toBe(false)
    expect(tokensMatch('abc', 'abc')).toBe(true)
  })
})

describe('setShareState', () => {
  let db: TestDb
  let deckId: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    deckId = createDeck(db, 'user-a', { name: 'Deck', description: null }).id
  })

  it('creates a token on private -> link, keeps it on link -> public, and nulls it on -> private', () => {
    const linked = setShareState(db, 'user-a', 'deck', deckId, { visibility: 'link' })
    expect(linked.visibility).toBe('link')
    expect(linked.shareToken).not.toBeNull()

    const madePublic = setShareState(db, 'user-a', 'deck', deckId, { visibility: 'public' })
    expect(madePublic.shareToken).toBe(linked.shareToken)

    const madePrivate = setShareState(db, 'user-a', 'deck', deckId, { visibility: 'private' })
    expect(madePrivate.shareToken).toBeNull()

    // The previously valid token no longer grants access once private.
    const access = resolveAccess(
      db,
      { resourceType: 'deck', resourceId: deckId, ownerUserId: 'user-a', visibility: 'private', shareToken: null },
      'user-c',
      linked.shareToken!,
    )
    expect(access.allowed).toBe(false)
  })

  it('regenerateToken produces a different token', () => {
    const first = setShareState(db, 'user-a', 'deck', deckId, { visibility: 'link' })
    const second = setShareState(db, 'user-a', 'deck', deckId, { regenerateToken: true })

    expect(second.shareToken).not.toBe(first.shareToken)
  })

  it('rejects regenerating a link for a private resource', () => {
    expect(() => setShareState(db, 'user-a', 'deck', deckId, { regenerateToken: true }))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('requireViewableDeck', () => {
  let db: TestDb
  let deckId: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    deckId = createDeck(db, 'user-a', { name: 'Deck', description: null }).id
  })

  it('throws 404 for a stranger on a private deck', () => {
    expect(() => requireViewableDeck(db, 'user-b', deckId, {}))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
  })

  it('throws 404 for a wrong token', () => {
    setShareState(db, 'user-a', 'deck', deckId, { visibility: 'link' })

    expect(() => requireViewableDeck(db, null, deckId, { token: 'wrong-token' }))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
  })

  it('throws 404 when the handle/owner in the URL does not own the deck', () => {
    setShareState(db, 'user-a', 'deck', deckId, { visibility: 'public' })

    expect(() => requireViewableDeck(db, null, deckId, { expectedOwnerUserId: 'user-b' }))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
  })

  it('succeeds for an anonymous viewer of a public deck with the right owner', () => {
    setShareState(db, 'user-a', 'deck', deckId, { visibility: 'public' })

    const { access } = requireViewableDeck(db, null, deckId, { expectedOwnerUserId: 'user-a' })
    expect(access.via).toBe('public')
  })
})

describe('requireViewableCollection and requireViewableInventory', () => {
  it('404s a foreign collection and allows a public one', async () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    const box = await createCollection(db, 'user-a', { name: 'Box 1', description: null })

    expect(() => requireViewableCollection(db, 'user-b', box.id, {}))
      .toThrow(expect.objectContaining({ statusCode: 404 }))

    setShareState(db, 'user-a', 'collection', box.id, { visibility: 'public' })
    const { access } = requireViewableCollection(db, 'user-b', box.id, {})
    expect(access.via).toBe('public')
  })

  it('404s a private inventory and allows it once granted', () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    ensureProfile(db, 'user-a')

    expect(() => requireViewableInventory(db, 'user-b', 'user-a', {}))
      .toThrow(expect.objectContaining({ statusCode: 404 }))

    addShareGrant(db, 'user-a', 'inventory', 'user-a', 'user-b')
    const { access } = requireViewableInventory(db, 'user-b', 'user-a', {})
    expect(access.via).toBe('grant')
  })
})

describe('share grants', () => {
  let db: TestDb
  let deckId: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    deckId = createDeck(db, 'user-a', { name: 'Deck', description: null }).id
  })

  it('rejects a self-share', () => {
    expect(() => addShareGrant(db, 'user-a', 'deck', deckId, 'user-a'))
      .toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('404s for an unknown user', () => {
    expect(() => addShareGrant(db, 'user-a', 'deck', deckId, 'no-such-user'))
      .toThrow(expect.objectContaining({ statusCode: 404, data: { code: 'share_user_not_found' } }))
  })

  it('404s for a foreign resource', () => {
    expect(() => addShareGrant(db, 'user-b', 'deck', deckId, 'user-c'))
      .toThrow(expect.objectContaining({ statusCode: 404, data: { code: 'deck_not_found' } }))
  })

  it('is idempotent: a second add does not duplicate the row', () => {
    addShareGrant(db, 'user-a', 'deck', deckId, 'user-b')
    addShareGrant(db, 'user-a', 'deck', deckId, 'user-b')

    const rows = db.select().from(schema.shareGrant).where(eq(schema.shareGrant.resourceId, deckId)).all()
    expect(rows).toHaveLength(1)
  })

  it('lists grants by display name/handle only, never an email', () => {
    addShareGrant(db, 'user-a', 'deck', deckId, 'user-b')

    const grants = listShareGrants(db, 'user-a', 'deck', deckId)
    expect(grants).toHaveLength(1)
    expect(grants[0]).not.toHaveProperty('email')
    expect(grants[0]!.userId).toBe('user-b')
  })

  it('removeShareGrant 404s when absent', () => {
    expect(() => removeShareGrant(db, 'user-a', 'deck', deckId, 'user-b'))
      .toThrow(expect.objectContaining({ statusCode: 404, data: { code: 'share_not_found' } }))
  })

  it('removeShareGrant removes an existing grant', () => {
    addShareGrant(db, 'user-a', 'deck', deckId, 'user-b')
    const state = removeShareGrant(db, 'user-a', 'deck', deckId, 'user-b')

    expect(state.grants).toEqual([])
  })
})

describe('deleteDeck cleans up grants', () => {
  it('removes the deck grants (deleteGrantsForResource wiring)', () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    const deckId = createDeck(db, 'user-a', { name: 'Deck', description: null }).id
    addShareGrant(db, 'user-a', 'deck', deckId, 'user-b')

    deleteDeck(db, 'user-a', deckId)

    const rows = db.select().from(schema.shareGrant).where(eq(schema.shareGrant.resourceId, deckId)).all()
    expect(rows).toEqual([])
  })
})

describe('deleteCollection cleans up grants', () => {
  it('removes the collection grants (deleteGrantsForResource wiring)', async () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    const box = await createCollection(db, 'user-a', { name: 'Box', description: null })
    addShareGrant(db, 'user-a', 'collection', box.id, 'user-b')

    await deleteCollection(db, 'user-a', box.id)

    const rows = db.select().from(schema.shareGrant).where(eq(schema.shareGrant.resourceId, box.id)).all()
    expect(rows).toEqual([])
  })
})

describe('listVisibleDecks', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('hides a link deck from a stranger but shows it to the owner', () => {
    const deckId = createDeck(db, 'user-a', { name: 'Linked', description: null }).id
    setShareState(db, 'user-a', 'deck', deckId, { visibility: 'link' })

    expect(listVisibleDecks(db, 'user-a', 'user-b').map(item => item.id)).toEqual([])
    expect(listVisibleDecks(db, 'user-a', 'user-a').map(item => item.id)).toEqual([deckId])
  })

  it('lists a public deck for everyone, including anonymous viewers', () => {
    const deckId = createDeck(db, 'user-a', { name: 'Public', description: null }).id
    setShareState(db, 'user-a', 'deck', deckId, { visibility: 'public' })

    expect(listVisibleDecks(db, 'user-a', 'user-b').map(item => item.id)).toEqual([deckId])
    expect(listVisibleDecks(db, 'user-a', null).map(item => item.id)).toEqual([deckId])
  })

  it('lists a granted private deck only for the grantee', () => {
    const deckId = createDeck(db, 'user-a', { name: 'Granted', description: null }).id
    addShareGrant(db, 'user-a', 'deck', deckId, 'user-b')

    expect(listVisibleDecks(db, 'user-a', 'user-b').map(item => item.id)).toEqual([deckId])
    expect(listVisibleDecks(db, 'user-a', 'user-c').map(item => item.id)).toEqual([])
  })

  it('nulls out visibility for a non-owner (the grant does not entitle them to the owner-side setting)', () => {
    const deckId = createDeck(db, 'user-a', { name: 'Granted', description: null }).id
    addShareGrant(db, 'user-a', 'deck', deckId, 'user-b')

    expect(listVisibleDecks(db, 'user-a', 'user-b')[0]?.visibility).toBeNull()
    expect(listVisibleDecks(db, 'user-a', 'user-a')[0]?.visibility).toBe('private')
  })

  it('carries each listed deck\'s cover card (#29)', () => {
    db.insert(schema.catalogCardImage).values({
      id: CARD.darkMagician,
      cardId: CARD.darkMagician,
      imageUrl: 'https://images.example/cards/46986414.jpg',
      imageUrlSmall: 'https://images.example/cards_small/46986414.jpg',
    }).run()
    const deckId = createDeck(db, 'user-a', { name: 'Public', description: null }).id
    upsertDeckCard(db, 'user-a', deckId, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })
    setShareState(db, 'user-a', 'deck', deckId, { visibility: 'public' })
    const emptyId = createDeck(db, 'user-a', { name: 'Leer', description: null }).id
    setShareState(db, 'user-a', 'deck', emptyId, { visibility: 'public' })

    const decks = listVisibleDecks(db, 'user-a', null)

    expect(decks.find(item => item.id === deckId)?.cover).toEqual({
      catalogCardId: CARD.darkMagician,
      name: 'Dark Magician',
      imageSmall: 'https://images.example/cards_small/46986414.jpg',
      imageLarge: 'https://images.example/cards/46986414.jpg',
    })
    expect(decks.find(item => item.id === emptyId)?.cover).toBeNull()
  })
})

describe('buildSharedDeckView', () => {
  it('drops owned/usedInDeck/shortfall while keeping counts/warnings/format/validation', () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    const deckId = createDeck(db, 'user-a', { name: 'Deck', description: null }).id
    upsertDeckCard(db, 'user-a', deckId, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 })

    const deckRow = db.select().from(schema.deck).where(eq(schema.deck.id, deckId)).get()!
    const profile = ensureProfile(db, 'user-a')

    const view = buildSharedDeckView(db, deckRow, toPublicProfile(profile))

    expect(view.sections.main).toHaveLength(1)
    for (const row of view.sections.main) {
      expect(row).not.toHaveProperty('owned')
      expect(row).not.toHaveProperty('usedInDeck')
      expect(row).not.toHaveProperty('shortfall')
    }
    expect(view.counts).toEqual({ main: 3, extra: 0, side: 0, total: 3 })
    expect(view.warnings.length).toBeGreaterThan(0)
    expect(view.format).toBeNull()
    expect(view.validation).toBeNull()
    expect(view.isOwner).toBe(false)
  })

  it('returns the small and the large scan of the same artwork for click-to-enlarge', () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    db.insert(schema.catalogCardImage).values([
      { id: 46986414, cardId: CARD.darkMagician, imageUrl: 'https://img/cards/46986414.jpg', imageUrlSmall: 'https://img/cards_small/46986414.jpg' },
      { id: 46986415, cardId: CARD.darkMagician, imageUrl: 'https://img/cards/46986415.jpg', imageUrlSmall: 'https://img/cards_small/46986415.jpg' },
    ]).run()
    const deckId = createDeck(db, 'user-a', { name: 'Deck', description: null }).id
    upsertDeckCard(db, 'user-a', deckId, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 })
    const deckRow = db.select().from(schema.deck).where(eq(schema.deck.id, deckId)).get()!

    const view = buildSharedDeckView(db, deckRow, toPublicProfile(ensureProfile(db, 'user-a')))

    expect(view.sections.main[0]).toMatchObject({
      imageSmall: 'https://img/cards_small/46986414.jpg',
      imageLarge: 'https://img/cards/46986414.jpg',
    })
  })
})

describe('listSharedCollection', () => {
  it('sums quantities strictly by collectionId, not across all of a user collections', async () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    const boxA = await createCollection(db, 'user-a', { name: 'Box A', description: null })
    const boxB = await createCollection(db, 'user-a', { name: 'Box B', description: null })

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: CARD.darkMagician,
      collection_id: boxA.id,
      quantity: 2,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: CARD.darkMagician,
      collection_id: boxB.id,
      quantity: 3,
    }))

    const page = listSharedCollection(db, 'user-a', boxA.id, {})
    const item = page.items.find(entry => entry.catalogCardId === CARD.darkMagician)
    expect(item?.quantity).toBe(2)
  })
})

describe('listSharedInventory', () => {
  it('aggregates a user\'s copies across all of their collections, scoped to that owner only', async () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    const boxA = await createCollection(db, 'user-a', { name: 'Box A', description: null })
    const boxB = await createCollection(db, 'user-a', { name: 'Box B', description: null })

    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: CARD.darkMagician,
      collection_id: boxA.id,
      quantity: 2,
    }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({
      catalog_card_id: CARD.darkMagician,
      collection_id: boxB.id,
      quantity: 3,
    }))
    // A second user's inventory must never leak into user-a's shared view.
    await addOwnedCard(db, 'user-b', validateInventoryInput({
      catalog_card_id: CARD.potOfGreed,
      quantity: 9,
    }))

    const page = listSharedInventory(db, 'user-a', {})

    expect(page.total).toBe(1)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ catalogCardId: CARD.darkMagician, quantity: 5, imageSmall: null, imageLarge: null })
  })

  it('filters by name and clamps the page size', async () => {
    const db = createTestDb()
    seedUsersAndCatalog(db)
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: CARD.darkMagician, quantity: 1 }))
    await addOwnedCard(db, 'user-a', validateInventoryInput({ catalog_card_id: CARD.potOfGreed, quantity: 1 }))

    const filtered = listSharedInventory(db, 'user-a', { q: 'Dark' })
    expect(filtered.items.map(item => item.catalogCardId)).toEqual([CARD.darkMagician])

    const clamped = listSharedInventory(db, 'user-a', { pageSize: 1000 })
    expect(clamped.pageSize).toBe(100)
  })
})
