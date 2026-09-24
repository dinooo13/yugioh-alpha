import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'

// Migration 0014 (ADR 0017): merges owned-card rows that only differed by
// printing, language, condition or edition, then resets those columns.

const MIGRATIONS = './server/db/migrations'
const DARK_MAGICIAN = 46986414
const POT_OF_GREED = 55144522

function mergeStatements(): string[] {
  const file = readdirSync(MIGRATIONS).find(name => /^0014_.*\.sql$/.test(name))
  expect(file).toBeDefined()
  return readFileSync(join(MIGRATIONS, file!), 'utf8')
    .split('--> statement-breakpoint')
    .map(statement => statement.trim())
    .filter(statement => statement !== '')
}

interface OwnedRow {
  id: string
  user_id: string
  catalog_card_id: number
  collection_id: string | null
  printing_id: string | null
  quantity: number
  language: string
  condition: string
  edition: string
  note: string | null
  created_at: number
  updated_at: number
}

describe('migration 0014: merge owned cards without collector details', () => {
  let sqlite: Database.Database

  function insertOwned(row: Partial<OwnedRow> & Pick<OwnedRow, 'id' | 'catalog_card_id' | 'quantity' | 'created_at'>) {
    sqlite.prepare(`
      INSERT INTO owned_card (id, user_id, catalog_card_id, printing_id, collection_id, quantity, language, condition, edition, note, created_at, updated_at)
      VALUES (@id, @user_id, @catalog_card_id, @printing_id, @collection_id, @quantity, @language, @condition, @edition, @note, @created_at, @updated_at)
    `).run({
      user_id: 'user-a',
      printing_id: null,
      collection_id: null,
      language: 'en',
      condition: 'near_mint',
      edition: 'unlimited',
      note: null,
      updated_at: row.created_at,
      ...row,
    })
  }

  function ownedRows(): OwnedRow[] {
    return sqlite.prepare('SELECT * FROM owned_card ORDER BY id').all() as OwnedRow[]
  }

  function runMerge() {
    for (const statement of mergeStatements()) {
      sqlite.exec(statement)
    }
  }

  beforeEach(() => {
    sqlite = new Database(':memory:')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder: MIGRATIONS })

    const now = new Date()
    db.insert(schema.user).values([
      { id: 'user-a', name: 'A', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
      { id: 'user-b', name: 'B', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    ]).run()
    db.insert(schema.catalogCard).values([
      { id: DARK_MAGICIAN, name: 'Dark Magician', type: 'Normal Monster', desc: '', syncedAt: now },
      { id: POT_OF_GREED, name: 'Pot of Greed', type: 'Spell Card', desc: '', syncedAt: now },
    ]).run()
    db.insert(schema.catalogSet).values({ id: 'lob', name: 'Legend of Blue Eyes White Dragon' }).run()
    db.insert(schema.catalogPrinting).values([
      { id: 'LOB-005', cardId: DARK_MAGICIAN, setId: 'lob', setCode: 'LOB-005', rarity: 'Ultra Rare' },
      { id: 'SDY-006', cardId: DARK_MAGICIAN, setId: 'lob', setCode: 'SDY-006', rarity: 'Ultra Rare' },
    ]).run()
    db.insert(schema.collection).values({ id: 'col-1', userId: 'user-a', name: 'Box 1', createdAt: now, updatedAt: now }).run()

    // Dark Magician without a collection: four rows that only differ by the
    // collector fields. `b-row` is the oldest, although `a-row` sorts first.
    insertOwned({ id: 'b-row', catalog_card_id: DARK_MAGICIAN, printing_id: 'LOB-005', quantity: 1, note: 'Binder', created_at: 100, updated_at: 150 })
    insertOwned({ id: 'a-row', catalog_card_id: DARK_MAGICIAN, language: 'de', edition: 'first', quantity: 2, note: '  Trade pile ', created_at: 200, updated_at: 400 })
    insertOwned({ id: 'c-row', catalog_card_id: DARK_MAGICIAN, language: 'fr', condition: 'played', quantity: 3, note: 'Binder', created_at: 300, updated_at: 250 })
    insertOwned({ id: 'd-row', catalog_card_id: DARK_MAGICIAN, quantity: 1, note: '   ', created_at: 350, updated_at: 100 })
    // Dark Magician in Box 1: a separate stack.
    insertOwned({ id: 'e-row', catalog_card_id: DARK_MAGICIAN, collection_id: 'col-1', printing_id: 'SDY-006', quantity: 2, created_at: 100, updated_at: 120 })
    insertOwned({ id: 'f-row', catalog_card_id: DARK_MAGICIAN, collection_id: 'col-1', language: 'de', quantity: 1, created_at: 500, updated_at: 600 })
    // A single row with a non-default language: only reset.
    insertOwned({ id: 'g-row', catalog_card_id: POT_OF_GREED, language: 'ja', quantity: 1, note: 'Japanese', created_at: 100 })
    // Another user's row with the same card never merges into user-a's stack.
    insertOwned({ id: 'h-row', user_id: 'user-b', catalog_card_id: DARK_MAGICIAN, language: 'de', quantity: 4, created_at: 50 })
  })

  it('merges rows that only differed by the collector fields', () => {
    runMerge()

    const rows = ownedRows()
    expect(rows.map(row => row.id)).toEqual(['b-row', 'e-row', 'g-row', 'h-row'])

    const unassigned = rows.find(row => row.id === 'b-row')!
    // The oldest row is kept with the summed quantity and the latest update.
    expect(unassigned).toMatchObject({ user_id: 'user-a', collection_id: null, quantity: 7, updated_at: 400 })
    // Distinct trimmed notes in first-use order; the blank one is dropped.
    expect(unassigned.note).toBe('Binder\nTrade pile')

    expect(rows.find(row => row.id === 'e-row')).toMatchObject({ collection_id: 'col-1', quantity: 3, note: null, updated_at: 600 })
    expect(rows.find(row => row.id === 'g-row')).toMatchObject({ quantity: 1, note: 'Japanese', created_at: 100 })
    expect(rows.find(row => row.id === 'h-row')).toMatchObject({ user_id: 'user-b', quantity: 4 })
  })

  it('resets every collector column to its default', () => {
    runMerge()

    for (const row of ownedRows()) {
      expect(row).toMatchObject({ printing_id: null, language: 'en', condition: 'near_mint', edition: 'unlimited' })
    }
  })

  it('is idempotent: a second run changes nothing', () => {
    runMerge()
    const once = ownedRows()

    runMerge()

    expect(ownedRows()).toEqual(once)
  })
})
