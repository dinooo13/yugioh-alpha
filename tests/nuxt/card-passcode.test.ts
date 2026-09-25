import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { resolveCatalogCardId, resolvePasscode } from '../../server/utils/card-passcode'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

const SYNCED_AT = new Date('2025-01-01T00:00:00.000Z')
const RETIRED_AT = new Date('2026-01-01T00:00:00.000Z')

// Dark Magician as YGOPRODeck lists it: card 46986420, the printed passcode
// 46986414 is one of its artworks.
const DARK_MAGICIAN = 46986420
const DARK_MAGICIAN_PRINTED = 46986414
const ODD_EYES = 16178683
const ODD_EYES_OLD = 16178681
// An artwork still on the retired Odd-Eyes row (before the next sync moves it).
const ODD_EYES_OLD_ARTWORK = 16178682
const DROPPED = 101402013
const UNKNOWN = 12345678

describe('card passcodes (ADR 0023)', () => {
  let db: ReturnType<typeof createTestDb>

  beforeAll(() => {
    db = createTestDb()
    const card = (id: number, extra: Partial<typeof schema.catalogCard.$inferInsert> = {}) =>
      ({ id, name: `Card ${id}`, type: 'Normal Monster', desc: '', syncedAt: SYNCED_AT, ...extra })
    db.insert(schema.catalogCard).values([card(DARK_MAGICIAN), card(ODD_EYES), card(DROPPED, { retiredAt: RETIRED_AT })]).run()
    db.insert(schema.catalogCard).values(card(ODD_EYES_OLD, { retiredAt: RETIRED_AT, replacedById: ODD_EYES })).run()
    const image = (id: number, cardId: number) => ({ id, cardId, imageUrl: `https://images.example/${id}.jpg` })
    db.insert(schema.catalogCardImage).values([
      image(DARK_MAGICIAN, DARK_MAGICIAN),
      image(DARK_MAGICIAN_PRINTED, DARK_MAGICIAN),
      image(ODD_EYES, ODD_EYES),
      image(ODD_EYES_OLD_ARTWORK, ODD_EYES_OLD),
      image(DROPPED, DROPPED),
    ]).run()
  })

  describe('resolveCatalogCardId', () => {
    it('keeps the id of a card row, active or retired', () => {
      expect(resolveCatalogCardId(db, DARK_MAGICIAN)).toBe(DARK_MAGICIAN)
      expect(resolveCatalogCardId(db, ODD_EYES_OLD)).toBe(ODD_EYES_OLD)
      expect(resolveCatalogCardId(db, DROPPED)).toBe(DROPPED)
    })

    it('resolves an artwork id to its card', () => {
      expect(resolveCatalogCardId(db, DARK_MAGICIAN_PRINTED)).toBe(DARK_MAGICIAN)
      expect(resolveCatalogCardId(db, ODD_EYES_OLD_ARTWORK)).toBe(ODD_EYES_OLD)
    })

    it('returns null for an unknown id', () => {
      expect(resolveCatalogCardId(db, UNKNOWN)).toBeNull()
    })
  })

  describe('resolvePasscode', () => {
    it('keeps an active card', () => {
      expect(resolvePasscode(db, DARK_MAGICIAN)).toBe(DARK_MAGICIAN)
    })

    it('resolves an artwork to its card', () => {
      expect(resolvePasscode(db, DARK_MAGICIAN_PRINTED)).toBe(DARK_MAGICIAN)
    })

    it('resolves a retired card with a replacement to the replacement', () => {
      expect(resolvePasscode(db, ODD_EYES_OLD)).toBe(ODD_EYES)
    })

    it('resolves an artwork of a retired card with a replacement to the replacement', () => {
      expect(resolvePasscode(db, ODD_EYES_OLD_ARTWORK)).toBe(ODD_EYES)
    })

    it('keeps a retired card without a replacement (searches filter it out)', () => {
      expect(resolvePasscode(db, DROPPED)).toBe(DROPPED)
    })

    it('returns null for an unknown passcode', () => {
      expect(resolvePasscode(db, UNKNOWN)).toBeNull()
    })
  })
})
