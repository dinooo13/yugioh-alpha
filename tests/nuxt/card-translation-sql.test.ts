// German name/text subqueries (ADR 0015) keep their card-id column qualified
// whatever query they sit in (#148, the drizzle problem R6-B hit in
// card-image-sql.ts): in a single-table select drizzle drops the table name
// from top-level column chunks, and a bare `"card_id"` inside the subquery
// would bind to the translation table itself.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { asc, eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { cardDescDeSql, cardNameDeSql, cardSortKey } from '../../server/utils/card-translation-sql'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

const BLUE_EYES = 89631139
const DARK_MAGICIAN = 46986414
const NO_GERMAN = 5000

function seed(db: TestDb) {
  const now = new Date()
  db.insert(schema.catalogCard).values([
    { id: BLUE_EYES, name: 'Blue-Eyes White Dragon', nameSearch: 'blue eyes white dragon', type: 'Normal Monster', desc: 'Dragon.', syncedAt: now },
    { id: DARK_MAGICIAN, name: 'Dark Magician', nameSearch: 'dark magician', type: 'Normal Monster', desc: 'Wizard.', syncedAt: now },
    { id: NO_GERMAN, name: 'Aardvark', nameSearch: 'aardvark', type: 'Spell Card', desc: 'None.', syncedAt: now },
  ]).run()
  db.insert(schema.catalogCardTranslation).values([
    { cardId: BLUE_EYES, locale: 'de', name: 'Blauäugiger w. Drache', nameSearch: 'blauaugiger w drache', desc: 'Drache.', source: 'ygoresources-git', syncedAt: now },
    { cardId: DARK_MAGICIAN, locale: 'de', name: 'Dunkler Magier', nameSearch: 'dunkler magier', desc: 'Magier.', source: 'ygoresources-git', syncedAt: now },
  ]).run()
  // Image ids differ from the card ids, so an `id` bound to the wrong table shows.
  db.insert(schema.catalogCardImage).values([
    { id: 1, cardId: DARK_MAGICIAN, imageUrl: 'l1', imageUrlSmall: 's1' },
    { id: 2, cardId: BLUE_EYES, imageUrl: 'l2', imageUrlSmall: 's2' },
    { id: 3, cardId: NO_GERMAN, imageUrl: 'l3', imageUrlSmall: 's3' },
  ]).run()
}

describe('German name and text subqueries', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seed(db)
  })

  it('reads each card\'s own German name and text in a single-table select over catalog_card', () => {
    const rows = db
      .select({ id: schema.catalogCard.id, nameDe: cardNameDeSql(), descDe: cardDescDeSql() })
      .from(schema.catalogCard)
      .orderBy(asc(schema.catalogCard.id))
      .all()

    expect(rows).toEqual([
      { id: NO_GERMAN, nameDe: null, descDe: null },
      { id: DARK_MAGICIAN, nameDe: 'Dunkler Magier', descDe: 'Magier.' },
      { id: BLUE_EYES, nameDe: 'Blauäugiger w. Drache', descDe: 'Drache.' },
    ])
  })

  // The old subquery came out as `"card_id" = "card_id"` here: every row got
  // the first German name in the table.
  it('reads the right card through another table\'s `card_id` in a single-table select', () => {
    const rows = db
      .select({
        imageId: schema.catalogCardImage.id,
        nameDe: cardNameDeSql(schema.catalogCardImage.cardId),
        descDe: cardDescDeSql(schema.catalogCardImage.cardId),
      })
      .from(schema.catalogCardImage)
      .orderBy(asc(schema.catalogCardImage.id))
      .all()

    expect(rows).toEqual([
      { imageId: 1, nameDe: 'Dunkler Magier', descDe: 'Magier.' },
      { imageId: 2, nameDe: 'Blauäugiger w. Drache', descDe: 'Drache.' },
      { imageId: 3, nameDe: null, descDe: null },
    ])
  })

  it('reads the right card in a join where both tables have an `id`', () => {
    const rows = db
      .select({ imageId: schema.catalogCardImage.id, nameDe: cardNameDeSql() })
      .from(schema.catalogCardImage)
      .innerJoin(schema.catalogCard, eq(schema.catalogCard.id, schema.catalogCardImage.cardId))
      .orderBy(asc(schema.catalogCardImage.id))
      .all()

    expect(rows).toEqual([
      { imageId: 1, nameDe: 'Dunkler Magier' },
      { imageId: 2, nameDe: 'Blauäugiger w. Drache' },
      { imageId: 3, nameDe: null },
    ])
  })

  it('sorts by the folded German name, else the English one, in the selection and in ORDER BY', () => {
    const rows = db
      .select({ id: schema.catalogCard.id, key: cardSortKey('de') })
      .from(schema.catalogCard)
      .orderBy(cardSortKey('de'))
      .all()

    expect(rows).toEqual([
      { id: NO_GERMAN, key: 'aardvark' },
      { id: BLUE_EYES, key: 'blauaugiger w drache' },
      { id: DARK_MAGICIAN, key: 'dunkler magier' },
    ])
  })
})
