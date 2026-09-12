import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  ensureProfile,
  getProfileByUserId,
  searchUsers,
  slugifyHandle,
  updateProfile,
  validateProfileUpdateInput,
} from '../../server/utils/profiles'

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
    { id: 'user-a', name: 'Fabian Meyer', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'Fabian Meyer', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-c', name: 'Charlie Chaplin', email: 'c@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()
}

describe('slugifyHandle', () => {
  it('lower-cases, strips diacritics, and collapses/trims separators', () => {
    expect(slugifyHandle('Fabian Meyer')).toBe('fabian-meyer')
    expect(slugifyHandle('Müller Königsberg')).toBe('muller-konigsberg')
    expect(slugifyHandle('  --a___b--  ')).toBe('a-b')
  })
})

describe('ensureProfile', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('creates a row with a slugified handle derived from user.name and is idempotent', () => {
    const created = ensureProfile(db, 'user-a')

    expect(created.displayName).toBe('Fabian Meyer')
    expect(created.handle).toMatch(/^fabian-meyer-[a-z0-9]{4}$/)
    expect(created.bio).toBeNull()
    expect(created.inventoryVisibility).toBe('private')
    expect(created.wishlistVisibility).toBe('private')

    const again = ensureProfile(db, 'user-a')
    expect(again).toEqual(created)
    expect(getProfileByUserId(db, 'user-a')).toEqual(created)
  })

  it('produces distinct handles for two users with the same name', () => {
    const a = ensureProfile(db, 'user-a')
    const b = ensureProfile(db, 'user-b')

    expect(a.handle).not.toBe(b.handle)
  })
})

describe('validateProfileUpdateInput', () => {
  it('normalizes a valid patch', () => {
    expect(validateProfileUpdateInput({ handle: 'fabian-1', displayName: '  Fabian  ', bio: '  hallo  ' }))
      .toEqual({ handle: 'fabian-1', displayName: 'Fabian', bio: 'hallo' })
  })

  it('rejects uppercase, space, underscore, too-short, and too-long handles', () => {
    expect(() => validateProfileUpdateInput({ handle: 'ABC' })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateProfileUpdateInput({ handle: 'a b' })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateProfileUpdateInput({ handle: 'a_b' })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateProfileUpdateInput({ handle: 'ab' })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateProfileUpdateInput({ handle: 'a'.repeat(31) })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects reserved handles', () => {
    expect(() => validateProfileUpdateInput({ handle: 'admin' })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateProfileUpdateInput({ handle: 'spieler' })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects an empty or overlong display name', () => {
    expect(() => validateProfileUpdateInput({ displayName: '   ' })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => validateProfileUpdateInput({ displayName: 'a'.repeat(61) })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('rejects an overlong bio, but accepts null', () => {
    expect(() => validateProfileUpdateInput({ bio: 'a'.repeat(501) })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(validateProfileUpdateInput({ bio: null })).toEqual({ bio: null })
  })
})

describe('updateProfile', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('throws 409 on a handle taken by another user', () => {
    ensureProfile(db, 'user-a')
    const b = ensureProfile(db, 'user-b')

    expect(() => updateProfile(db, 'user-a', { handle: b.handle }))
      .toThrow(expect.objectContaining({ statusCode: 409 }))
  })

  it('succeeds when the handle is the caller own', () => {
    const a = ensureProfile(db, 'user-a')

    const updated = updateProfile(db, 'user-a', { handle: a.handle, displayName: 'Neuer Name' })
    expect(updated.handle).toBe(a.handle)
    expect(updated.displayName).toBe('Neuer Name')
  })
})

describe('searchUsers', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
    ensureProfile(db, 'user-a')
    ensureProfile(db, 'user-b')
    ensureProfile(db, 'user-c')
  })

  it('matches a prefix on handle and on display name, excluding the caller', () => {
    const byDisplayName = searchUsers(db, 'user-a', 'fabian')
    expect(byDisplayName.some(item => item.userId === 'user-a')).toBe(false)
    expect(byDisplayName.some(item => item.userId === 'user-b')).toBe(true)

    const byCharlie = searchUsers(db, 'user-a', 'charlie')
    expect(byCharlie.map(item => item.userId)).toEqual(['user-c'])
  })

  it('returns [] for a term shorter than 2 characters', () => {
    expect(searchUsers(db, 'user-a', 'f')).toEqual([])
    expect(searchUsers(db, 'user-a', '')).toEqual([])
  })

  it('respects the limit', () => {
    expect(searchUsers(db, 'user-a', 'fabian', 1)).toHaveLength(1)
  })

  it('never returns an email', () => {
    const results = searchUsers(db, 'user-a', 'fabian')
    expect(results.length).toBeGreaterThan(0)
    for (const item of results) {
      expect(item).not.toHaveProperty('email')
    }
  })
})
