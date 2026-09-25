import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { seedCatalogFixture } from '../../server/db/fixtures/catalog-fixture'
import * as schema from '../../server/db/schema'
import { buildCardListWhere, parseCardListQuery } from '../../server/utils/catalog-query'
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
    {
      id: 7,
      name: 'Destiny Draw',
      type: 'Skill Card',
      frameType: 'skill',
      desc: 'Skill cards store the story character in `race`, truncated by the sync job.',
      // Real-world example from the UX review: "Abidos the Th" (13 chars).
      race: 'Abidos the Th',
      atk: null,
      def: null,
      level: null,
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
    // Internal join/search columns (ADR 0015) stay out of the API.
    expect(detail?.card).not.toHaveProperty('konamiId')
    expect(detail?.card).not.toHaveProperty('nameSearch')
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

    expect(facets.types).toEqual(['Effect Monster', 'Normal Monster', 'Skill Card', 'Spell Card'])
    expect(facets.attributes).toEqual(['DARK', 'LIGHT'])
    // Skill Cards store the story character's (truncated) name in `race`,
    // not a real monster race — excluded from the "Monsterart" facet (#17).
    expect(facets.races).toEqual(['Dragon', 'Normal', 'Spellcaster'])
    expect(facets.races).not.toContain('Abidos the Th')
    expect(facets.levels).toEqual([4, 7, 8])
    expect(facets.sets).toEqual([
      { id: 'legend-of-blue-eyes', name: 'Legend of Blue Eyes' },
      { id: 'structure-deck-kaiba', name: 'Structure Deck: Kaiba' },
    ])
  })

  it('still finds rows without a name_search through the raw English name', async () => {
    // The seed above inserts no `name_search` (it stays ''), like a database
    // before the startup backfill.
    const result = await searchCatalog(db, parseCardListQuery({ q: 'Dark Mag' }))

    expect(result.items.map(card => card.name)).toEqual(['Dark Magician'])
  })
})

describe('retired cards (ADR 0019)', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    seedCatalog(db)
    // A renumbered copy of Blue-Eyes (id 1) and a dropped card with facet
    // values no active card has.
    db.insert(schema.catalogCard).values([
      {
        id: 101,
        name: 'Blue-Eyes White Dragon',
        type: 'Normal Monster',
        desc: 'Placeholder.',
        syncedAt: new Date('2025-01-01T00:00:00Z'),
        retiredAt: new Date('2026-01-01T00:00:00Z'),
        replacedById: 1,
      },
      {
        id: 102,
        name: 'Retired Wind Fairy',
        type: 'Ritual Monster',
        desc: 'Gone.',
        race: 'Fairy',
        attribute: 'WIND',
        level: 12,
        syncedAt: new Date('2025-01-01T00:00:00Z'),
        retiredAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]).run()
  })

  it('hides retired cards from the search, with and without a query', async () => {
    const all = await searchCatalog(db, parseCardListQuery({ pageSize: '60' }))
    expect(all.total).toBe(7)
    expect(all.items.map(card => card.id)).not.toContain(101)
    expect(all.items.map(card => card.id)).not.toContain(102)

    const byName = await searchCatalog(db, parseCardListQuery({ q: 'Blue-Eyes' }))
    expect(byName.items.map(card => card.id)).toEqual([1])
  })

  it('hides retired cards from the facets', async () => {
    const facets = await getCatalogFacets(db)

    expect(facets.types).not.toContain('Ritual Monster')
    expect(facets.attributes).not.toContain('WIND')
    expect(facets.races).not.toContain('Fairy')
    expect(facets.levels).not.toContain(12)
  })

  it('still returns a retired card by id, flagged, with its replacement', async () => {
    const detail = await getCatalogCardDetail(db, 101)
    expect(detail?.card).toMatchObject({ id: 101, retired: true, replacedById: 1 })
    expect(detail?.card).not.toHaveProperty('retiredAt')

    const dropped = await getCatalogCardDetail(db, 102)
    expect(dropped?.card).toMatchObject({ retired: true, replacedById: null })

    const active = await getCatalogCardDetail(db, 1)
    expect(active?.card).toMatchObject({ retired: false, replacedById: null })
  })
})

describe('getCatalogCardDetail with artwork passcodes (ADR 0023)', () => {
  const syncedAt = new Date('2026-01-01T00:00:00Z')
  const DARK_MAGICIAN = 46986420
  const PRINTED = 46986414
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    db.insert(schema.catalogCard).values([
      { id: DARK_MAGICIAN, name: 'Dark Magician', type: 'Normal Monster', desc: 'Wizard.', syncedAt },
      // A card whose id is also another card's artwork id.
      { id: 555, name: 'Card Row', type: 'Spell Card', desc: 'Row.', syncedAt },
    ]).run()
    db.insert(schema.catalogSet).values({ id: 'lob', name: 'Legend of Blue Eyes' }).run()
    db.insert(schema.catalogPrinting).values({ id: 'LOB-005', cardId: DARK_MAGICIAN, setId: 'lob', setCode: 'LOB-005' }).run()
    db.insert(schema.catalogCardImage).values([
      { id: PRINTED, cardId: DARK_MAGICIAN, imageUrl: 'https://img/46986414.jpg' },
      { id: DARK_MAGICIAN, cardId: DARK_MAGICIAN, imageUrl: 'https://img/46986420.jpg' },
      { id: 555, cardId: DARK_MAGICIAN, imageUrl: 'https://img/555.jpg' },
    ]).run()
  })

  it('returns the card an artwork id belongs to, with its printings and images', async () => {
    const detail = await getCatalogCardDetail(db, PRINTED)

    expect(detail?.card).toMatchObject({ id: DARK_MAGICIAN, name: 'Dark Magician', retired: false })
    expect(detail?.printings.map(printing => printing.setCode)).toEqual(['LOB-005'])
    // The primary artwork (the card's own id, ADR 0025) first, then by id.
    expect(detail?.images.map(image => image.id)).toEqual([DARK_MAGICIAN, 555, PRINTED])
  })

  it('prefers a card row over an artwork with the same id', async () => {
    const detail = await getCatalogCardDetail(db, 555)
    expect(detail?.card).toMatchObject({ id: 555, name: 'Card Row' })
  })

  it('returns null for an id that is neither a card nor an artwork', async () => {
    await expect(getCatalogCardDetail(db, 12345678)).resolves.toBeNull()
  })
})

describe('bilingual catalog search (ADR 0015)', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    seedCatalogFixture(db)
  })

  async function names(query: Record<string, string>) {
    const result = await searchCatalog(db, parseCardListQuery({ pageSize: '60', ...query }))
    return result.items.map(card => card.name)
  }

  it('finds a card by its German name, case- and space-insensitively', async () => {
    expect(await names({ q: 'Dunkler' })).toEqual(['Dark Magician'])
    expect(await names({ q: 'dunkler magier' })).toEqual(['Dark Magician'])
    expect(await names({ q: 'Topf der Gier' })).toEqual(['Pot of Greed'])
  })

  it('folds umlauts and case on both sides', async () => {
    for (const q of ['blauäugiger w', 'BLAUÄUGIGER W', 'Blauaugiger w', 'w drache']) {
      expect(await names({ q }), q).toEqual(['Blue-Eyes White Dragon'])
    }
    expect(await names({ q: 'BLAUÄUGIGER' })).toEqual(['Blue-Eyes Ultimate Dragon', 'Blue-Eyes White Dragon'])
  })

  it('finds English names through the folded form too', async () => {
    expect(await names({ q: 'blue eyes white' })).toEqual(['Blue-Eyes White Dragon'])
    expect(await names({ q: 'number 39 utopia' })).toEqual(['Number 39: Utopia'])
  })

  it('searches the German card text with inText', async () => {
    expect(await names({ q: 'Hexer' })).toEqual([])
    expect(await names({ q: 'Hexer', inText: '1' })).toEqual(['Dark Magician'])
  })

  it('treats LIKE wildcards as literal characters', async () => {
    expect(await names({ q: '%' })).toEqual([])
    expect(await names({ q: '_' })).toEqual([])
  })

  it('reads the German names from the covering index', () => {
    const where = buildCardListWhere(parseCardListQuery({ q: 'dunkler' }))
    const query = db.select({ id: schema.catalogCard.id }).from(schema.catalogCard).where(where).toSQL()
    const plan = db.$client.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params) as Array<{ detail: string }>

    expect(plan.map(row => row.detail)).toContainEqual(
      expect.stringContaining('USING COVERING INDEX idx_catalog_card_translation_search'),
    )
  })
})
