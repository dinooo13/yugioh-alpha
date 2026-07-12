import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { parseCardListQuery } from '../../server/utils/catalog-query'
import { getCatalogCardDetail, getCatalogFacets, searchCatalog } from '../../server/utils/catalog-search'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

function seedCatalog(db: ReturnType<typeof createTestDb>) {
  const syncedAt = new Date('2026-01-01T00:00:00Z')

  db.insert(schema.catalogCard).values([
    {
      id: 1,
      name: 'Blue-Eyes White Dragon',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'This legendary dragon is a powerful engine of destruction.',
      race: 'Dragon',
      attribute: 'LIGHT',
      atk: 3000,
      def: 2500,
      level: 8,
      tcgDate: '2002-03-08',
      syncedAt,
    },
    {
      id: 2,
      name: 'Dark Magician',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'The ultimate wizard in terms of attack and defense.',
      race: 'Spellcaster',
      attribute: 'DARK',
      atk: 2500,
      def: 2100,
      level: 7,
      tcgDate: '2002-03-08',
      syncedAt,
    },
    {
      id: 3,
      name: 'Pot of Greed',
      type: 'Spell Card',
      frameType: 'spell',
      desc: 'Draw 2 cards.',
      race: 'Normal',
      atk: null,
      def: null,
      level: null,
      tcgDate: '2002-03-08',
      syncedAt,
    },
    {
      id: 4,
      name: 'Dragon Shrine',
      type: 'Spell Card',
      frameType: 'spell',
      desc: 'Send 1 Dragon monster from your Deck to the GY.',
      race: 'Normal',
      atk: null,
      def: null,
      level: null,
      tcgDate: '2013-09-13',
      syncedAt,
    },
    {
      id: 5,
      name: '50%_off Dragon',
      type: 'Effect Monster',
      frameType: 'effect',
      desc: 'Literal wildcard test card.',
      race: 'Dragon',
      attribute: 'LIGHT',
      atk: 500,
      def: 500,
      level: 4,
      tcgDate: '2020-01-01',
      syncedAt,
    },
    {
      id: 6,
      name: '500xoff Dragon',
      type: 'Effect Monster',
      frameType: 'effect',
      desc: 'Should not match escaped wildcard searches.',
      race: 'Dragon',
      attribute: 'LIGHT',
      atk: 500,
      def: 500,
      level: 4,
      tcgDate: '2020-01-01',
      syncedAt,
    },
  ]).run()

  db.insert(schema.catalogSet).values([
    { id: 'legend-of-blue-eyes', name: 'Legend of Blue Eyes' },
    { id: 'structure-deck-kaiba', name: 'Structure Deck: Kaiba' },
  ]).run()

  db.insert(schema.catalogPrinting).values([
    { id: 'LOB-001', cardId: 1, setId: 'legend-of-blue-eyes', setCode: 'LOB-001', rarity: 'Ultra Rare', price: '10.00' },
    { id: 'SDK-001', cardId: 1, setId: 'structure-deck-kaiba', setCode: 'SDK-001', rarity: 'Common', price: '1.00' },
    { id: 'LOB-005', cardId: 2, setId: 'legend-of-blue-eyes', setCode: 'LOB-005', rarity: 'Ultra Rare', price: '8.00' },
  ]).run()

  db.insert(schema.catalogCardImage).values([
    { id: 100, cardId: 1, imageUrl: 'https://img/blue.jpg', imageUrlSmall: 'https://img/blue-small.jpg', imageUrlCropped: 'https://img/blue-crop.jpg' },
    { id: 101, cardId: 1, imageUrl: 'https://img/blue-alt.jpg', imageUrlSmall: 'https://img/blue-alt-small.jpg', imageUrlCropped: 'https://img/blue-alt-crop.jpg' },
    { id: 200, cardId: 2, imageUrl: 'https://img/dark.jpg', imageUrlSmall: 'https://img/dark-small.jpg', imageUrlCropped: 'https://img/dark-crop.jpg' },
  ]).run()
}

describe('catalog search utilities', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    seedCatalog(db)
  })

  it('filters and paginates catalog cards', async () => {
    const result = await searchCatalog(db, parseCardListQuery({
      type: 'Spell Card',
      pageSize: '1',
      page: '2',
    }))

    expect(result.total).toBe(2)
    expect(result.page).toBe(2)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.type).toBe('Spell Card')
  })

  it('searches card names case-insensitively', async () => {
    const result = await searchCatalog(db, parseCardListQuery({ q: 'blue' }))

    expect(result.items.map(card => card.name)).toEqual(['Blue-Eyes White Dragon'])
    expect(result.items[0]!.imageSmall).toBe('https://img/blue-small.jpg')
  })

  it('treats LIKE wildcards in search input as literal characters', async () => {
    const result = await searchCatalog(db, parseCardListQuery({ q: '50%_off' }))

    expect(result.items.map(card => card.name)).toEqual(['50%_off Dragon'])
  })

  it('filters through printings by set id', async () => {
    const result = await searchCatalog(db, parseCardListQuery({ setId: 'structure-deck-kaiba' }))

    expect(result.items.map(card => card.name)).toEqual(['Blue-Eyes White Dragon'])
  })

  it('returns card detail with printings and images', async () => {
    const detail = await getCatalogCardDetail(db, 1)

    expect(detail?.card.name).toBe('Blue-Eyes White Dragon')
    expect(detail?.printings).toHaveLength(2)
    expect(detail?.printings[0]).toMatchObject({ setCode: 'LOB-001', setName: 'Legend of Blue Eyes' })
    expect(detail?.images.map(image => image.imageUrlSmall)).toEqual([
      'https://img/blue-small.jpg',
      'https://img/blue-alt-small.jpg',
    ])
  })

  it('returns null for missing card detail', async () => {
    await expect(getCatalogCardDetail(db, 999)).resolves.toBeNull()
  })

  it('returns distinct facets', async () => {
    const facets = await getCatalogFacets(db)

    expect(facets.types).toEqual(['Effect Monster', 'Normal Monster', 'Spell Card'])
    expect(facets.attributes).toEqual(['DARK', 'LIGHT'])
    expect(facets.races).toEqual(['Dragon', 'Normal', 'Spellcaster'])
    expect(facets.levels).toEqual([4, 7, 8])
    expect(facets.sets).toEqual([
      { id: 'legend-of-blue-eyes', name: 'Legend of Blue Eyes' },
      { id: 'structure-deck-kaiba', name: 'Structure Deck: Kaiba' },
    ])
  })
})
