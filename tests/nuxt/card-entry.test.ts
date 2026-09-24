import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { CATALOG_FIXTURE_IDS, seedCatalogFixture } from '../../server/db/fixtures/catalog-fixture'
import * as schema from '../../server/db/schema'
import {
  MAX_ENTRY_LINES,
  normalizeCardName,
  parseEntryLine,
  parseEntryText,
  parseSuggestLimit,
  parseSuggestRequest,
  resolveEntryLine,
  similarity,
  suggestCatalogMatches,
} from '../../server/utils/card-entry'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

const SYNCED_AT = new Date('2025-01-01T00:00:00.000Z')

// Cards whose names collide with the quantity/comma parsing rules, plus a
// non-ASCII name, are not in the shared E2E fixture — they only matter here.
function seedTrickyNames(db: TestDb) {
  db.insert(schema.catalogCard).values([
    { id: 23771716, name: '7 Colored Fish', type: 'Normal Monster', desc: 'A fish.', syncedAt: SYNCED_AT },
    { id: 11714098, name: '30,000-Year White Turtle', type: 'Normal Monster', desc: 'A turtle.', syncedAt: SYNCED_AT },
    { id: 89631140, name: '青眼の白龍', type: 'Normal Monster', desc: 'Blue-Eyes, OCG name.', syncedAt: SYNCED_AT },
  ]).run()
}

// A pool far larger than CANDIDATE_POOL_LIMIT that all share one token.
function seedDragonFlood(db: TestDb) {
  db.insert(schema.catalogCard).values([
    { id: 900000, name: 'Dragon', type: 'Normal Monster', desc: 'Just a dragon.', syncedAt: SYNCED_AT },
    ...Array.from({ length: 250 }, (_, index) => ({
      id: 900001 + index,
      name: `Dragon Filler ${String(index).padStart(3, '0')}`,
      type: 'Normal Monster',
      desc: 'Filler.',
      syncedAt: SYNCED_AT,
    })),
  ]).run()
}

describe('parseEntryLine', () => {
  it('reads a leading multiplier', () => {
    expect(parseEntryLine('3x Dark Magician')).toMatchObject({
      raw: '3x Dark Magician',
      quantity: 3,
      query: 'Dark Magician',
    })
  })

  it('reads a trailing multiplier', () => {
    expect(parseEntryLine('Dark Magician x3')).toMatchObject({ quantity: 3, query: 'Dark Magician' })
  })

  it('reads a bare leading count', () => {
    expect(parseEntryLine('3 Dark Magician')).toMatchObject({ quantity: 3, query: 'Dark Magician' })
  })

  it('defaults the quantity to 1 and caps it at 99', () => {
    expect(parseEntryLine('Pot of Greed')).toMatchObject({ quantity: 1, query: 'Pot of Greed' })
    expect(parseEntryLine('250x Kuriboh')).toMatchObject({ quantity: 99, query: 'Kuriboh' })
    expect(parseEntryLine('0x Kuriboh')).toMatchObject({ quantity: 1, query: 'Kuriboh' })
  })

  it('extracts a parenthesized set code and keeps the name as the query', () => {
    expect(parseEntryLine('2x Dark Magician (SDY-006)')).toMatchObject({
      quantity: 2,
      query: 'Dark Magician',
      setCode: 'SDY-006',
    })
  })

  it('extracts a lowercase parenthesized set code', () => {
    expect(parseEntryLine('dark magician (sdy-006)')).toMatchObject({
      quantity: 1,
      query: 'dark magician',
      setCode: 'SDY-006',
    })
  })

  it('treats a bare set code as both query and set code', () => {
    expect(parseEntryLine('sdy-006')).toMatchObject({ quantity: 1, query: 'SDY-006', setCode: 'SDY-006' })
    expect(parseEntryLine('LDS2-EN018')).toMatchObject({ query: 'LDS2-EN018', setCode: 'LDS2-EN018' })
  })

  it('recognizes a bare 8-digit passcode', () => {
    expect(parseEntryLine(' 46986414 ')).toMatchObject({ quantity: 1, query: '46986414', passcode: 46986414 })
    expect(parseEntryLine('2 46986414')).toMatchObject({ quantity: 2, passcode: 46986414 })
    expect(parseEntryLine('4698641')).not.toHaveProperty('passcode')
  })

  it('normalizes whitespace, tabs, and commas', () => {
    expect(parseEntryLine('\t2\tPot of Greed  ')).toMatchObject({ quantity: 2, query: 'Pot of Greed' })
    expect(parseEntryLine('3,Dark Magician')).toMatchObject({ quantity: 3, query: 'Dark Magician' })
    expect(parseEntryLine('   ')).toMatchObject({ quantity: 1, query: '' })
  })

  it('ignores a line that is only a quantity', () => {
    expect(parseEntryLine('3x')).toMatchObject({ quantity: 1, query: '' })
    expect(parseEntryLine('12')).toMatchObject({ quantity: 1, query: '' })
    expect(parseEntryText('3x\n2\nKuriboh')).toHaveLength(1)
  })

  it('keeps a dangling multiplier letter and trailing digits in the name', () => {
    expect(parseEntryLine('Kuriboh x')).toMatchObject({ quantity: 1, query: 'Kuriboh x' })
    expect(parseEntryLine('Ojama Trio 2')).toMatchObject({ quantity: 1, query: 'Ojama Trio 2' })
  })
})

describe('parseEntryText', () => {
  it('parses one card per line and skips blank lines', () => {
    const parsed = parseEntryText('2x Dark Magician\n\n  \nPot of Greed\r\nSDY-006')

    expect(parsed).toHaveLength(3)
    expect(parsed.map(line => line.query)).toEqual(['Dark Magician', 'Pot of Greed', 'SDY-006'])
    expect(parsed[0]!.quantity).toBe(2)
  })
})

describe('similarity', () => {
  it('scores OCR-style typos high and unrelated names low', () => {
    expect(similarity('darkmagician', 'darkmagician')).toBe(1)
    expect(similarity('darkmagican', 'darkmagician')).toBeGreaterThan(0.85)
    expect(similarity('blueeyeswhitedragen', 'blueeyeswhitedragon')).toBeGreaterThan(0.85)
    expect(similarity('potofgreed', 'darkmagician')).toBeLessThan(0.2)
  })
})

describe('suggestCatalogMatches', () => {
  let db: TestDb

  beforeAll(() => {
    db = createTestDb()
    seedCatalogFixture(db)
    seedTrickyNames(db)
  })

  it('matches an exact name with full confidence and returns its printings', () => {
    const [best, ...rest] = suggestCatalogMatches(db, parseEntryLine('Dark Magician'))

    expect(best).toMatchObject({
      cardId: CATALOG_FIXTURE_IDS.darkMagician,
      name: 'Dark Magician',
      type: 'Normal Monster',
      matchedBy: 'exact',
      score: 1,
    })
    expect(best!.imageSmall).toContain(String(CATALOG_FIXTURE_IDS.darkMagician))
    expect(best!.printings.map(printing => printing.setCode)).toEqual(['LOB-005', 'SDY-006'])
    expect(best!.printings[0]).toMatchObject({
      id: 'LOB-005',
      setName: 'Legend of Blue Eyes White Dragon',
      rarity: 'Ultra Rare',
    })
    expect(rest.every(candidate => candidate.score <= best!.score)).toBe(true)
  })

  it('matches a set code case-insensitively', () => {
    const candidates = suggestCatalogMatches(db, parseEntryLine('sdy-006'))

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      cardId: CATALOG_FIXTURE_IDS.darkMagician,
      matchedBy: 'set_code',
      score: 1,
    })
  })

  it('matches a passcode to the exact catalog id', () => {
    const candidates = suggestCatalogMatches(db, parseEntryLine(String(CATALOG_FIXTURE_IDS.potOfGreed)))

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      cardId: CATALOG_FIXTURE_IDS.potOfGreed,
      name: 'Pot of Greed',
      matchedBy: 'passcode',
      score: 1,
    })
  })

  it('prefers the set code over a name hit when both are present', () => {
    const candidates = suggestCatalogMatches(db, parseEntryLine('2x Dark Magician (SDY-006)'))

    expect(candidates[0]).toMatchObject({
      cardId: CATALOG_FIXTURE_IDS.darkMagician,
      matchedBy: 'set_code',
      score: 1,
    })
  })

  it('keeps both cards when the set code contradicts the name', () => {
    const candidates = suggestCatalogMatches(db, parseEntryLine('Pot of Greed (SDY-006)'))

    expect(candidates.find(candidate => candidate.matchedBy === 'set_code')?.cardId)
      .toBe(CATALOG_FIXTURE_IDS.darkMagician)
    expect(candidates.find(candidate => candidate.matchedBy === 'exact')?.cardId)
      .toBe(CATALOG_FIXTURE_IDS.potOfGreed)
  })

  it('still finds misspelled names from OCR or speech input', () => {
    const misspelled = suggestCatalogMatches(db, parseEntryLine('Dark Magican'))
    expect(misspelled[0]).toMatchObject({
      cardId: CATALOG_FIXTURE_IDS.darkMagician,
      matchedBy: 'fuzzy',
    })
    expect(misspelled[0]!.score).toBeGreaterThanOrEqual(0.85)

    const dictated = suggestCatalogMatches(db, parseEntryLine('Blue Eyes White Dragen'))
    expect(dictated[0]).toMatchObject({
      cardId: CATALOG_FIXTURE_IDS.blueEyesWhiteDragon,
      name: 'Blue-Eyes White Dragon',
    })
    expect(dictated[0]!.score).toBeGreaterThanOrEqual(0.85)
  })

  it('ranks the closer card first for a shared prefix', () => {
    const candidates = suggestCatalogMatches(db, parseEntryLine('Blue-Eyes'))

    expect(candidates.length).toBeGreaterThan(1)
    expect(candidates[0]!.name).toBe('Blue-Eyes White Dragon')
    expect(candidates.map(candidate => candidate.name)).toContain('Blue-Eyes Ultimate Dragon')
    expect(candidates[0]!.score).toBeGreaterThanOrEqual(candidates[1]!.score)
    expect(candidates.every(candidate => candidate.matchedBy === 'prefix')).toBe(true)
  })

  it('returns no candidates for an unknown card', () => {
    expect(suggestCatalogMatches(db, parseEntryLine('Zzyzx Nonexistent Whatsit'))).toEqual([])
  })

  it('honours the limit', () => {
    expect(suggestCatalogMatches(db, parseEntryLine('Dragon'), { limit: 2 })).toHaveLength(2)
  })

  it('treats LIKE wildcards as literal characters', () => {
    expect(suggestCatalogMatches(db, parseEntryLine('%'))).toEqual([])
    expect(suggestCatalogMatches(db, parseEntryLine('_'))).toEqual([])
    expect(suggestCatalogMatches(db, parseEntryLine('%%%'))).toEqual([])
    expect(suggestCatalogMatches(db, parseEntryLine('\\'))).toEqual([])
  })

  it('searches names that normalize to an empty ASCII string', () => {
    const candidates = suggestCatalogMatches(db, parseEntryLine('青眼の白龍'))

    expect(candidates[0]).toMatchObject({ name: '青眼の白龍', matchedBy: 'exact', score: 1 })
  })
})

describe('suggestCatalogMatches with German names (ADR 0015)', () => {
  let db: TestDb

  beforeAll(() => {
    db = createTestDb()
    seedCatalogFixture(db)
  })

  it('matches a German name exactly, with the English and German names in the candidate', () => {
    const [best] = suggestCatalogMatches(db, parseEntryLine('2x Dunkler Magier'))

    expect(best).toMatchObject({
      cardId: CATALOG_FIXTURE_IDS.darkMagician,
      name: 'Dark Magician',
      nameDe: 'Dunkler Magier',
      matchedBy: 'exact',
      score: 1,
    })
    expect(best!.printings.map(printing => printing.setCode)).toEqual(['LOB-005', 'SDY-006'])
  })

  it('folds umlauts and punctuation in German names', () => {
    for (const line of ['Blauäugiger w. Drache', 'blauaugiger w drache', 'BLAUÄUGIGER W. DRACHE']) {
      expect(suggestCatalogMatches(db, parseEntryLine(line))[0], line).toMatchObject({
        cardId: CATALOG_FIXTURE_IDS.blueEyesWhiteDragon,
        matchedBy: 'exact',
        score: 1,
      })
    }
  })

  it('still finds misspelled German names', () => {
    const [best] = suggestCatalogMatches(db, parseEntryLine('Dunkler Magir'))

    expect(best).toMatchObject({ cardId: CATALOG_FIXTURE_IDS.darkMagician, matchedBy: 'fuzzy' })
    expect(best!.score).toBeGreaterThanOrEqual(0.85)
  })

  it('ranks German prefix hits like English ones', () => {
    const candidates = suggestCatalogMatches(db, parseEntryLine('Blauäugiger'))

    expect(candidates.map(candidate => candidate.cardId)).toEqual([
      CATALOG_FIXTURE_IDS.blueEyesWhiteDragon,
      CATALOG_FIXTURE_IDS.blueEyesUltimateDragon,
    ])
    expect(candidates.every(candidate => candidate.matchedBy === 'prefix')).toBe(true)
  })

  it('reports nameDe as null for a card without German data', () => {
    const [best] = suggestCatalogMatches(db, parseEntryLine('Raigeki'))

    expect(best).toMatchObject({ cardId: CATALOG_FIXTURE_IDS.raigeki, nameDe: null, matchedBy: 'exact' })
  })
})

describe('suggestCatalogMatches candidate pool', () => {
  it('still surfaces the exact match when a token floods the catalog', () => {
    const db = createTestDb()
    seedCatalogFixture(db)
    seedDragonFlood(db)

    const candidates = suggestCatalogMatches(db, parseEntryLine('Dragon'))

    expect(candidates[0]).toMatchObject({ name: 'Dragon', matchedBy: 'exact', score: 1 })
  })
})

describe('resolveEntryLine', () => {
  let db: TestDb

  beforeAll(() => {
    db = createTestDb()
    seedCatalogFixture(db)
    seedTrickyNames(db)
  })

  it('keeps a leading number that belongs to the card name', () => {
    const resolved = resolveEntryLine(db, parseEntryLine('7 Colored Fish'))

    expect(resolved).toMatchObject({ quantity: 1, query: '7 Colored Fish' })
    expect(suggestCatalogMatches(db, resolved)[0]).toMatchObject({ name: '7 Colored Fish', matchedBy: 'exact' })
  })

  it('keeps a comma that belongs to the card name', () => {
    const resolved = resolveEntryLine(db, parseEntryLine('30,000-Year White Turtle'))

    expect(resolved).toMatchObject({ quantity: 1, query: '30,000-Year White Turtle' })
    expect(suggestCatalogMatches(db, resolved)[0]).toMatchObject({
      name: '30,000-Year White Turtle',
      matchedBy: 'exact',
    })
  })

  it('leaves a real quantity alone', () => {
    expect(resolveEntryLine(db, parseEntryLine('3 Dark Magician'))).toMatchObject({
      quantity: 3,
      query: 'Dark Magician',
    })
    expect(resolveEntryLine(db, parseEntryLine('2x Kuriboh'))).toMatchObject({ quantity: 2, query: 'Kuriboh' })
  })

  it('keeps a leading number that belongs to a German card name', () => {
    // Hypothetical German name, only to give "7 Colored Fish" a German twin
    // that starts with a number as well.
    db.insert(schema.catalogCardTranslation).values({
      cardId: 23771716,
      locale: 'de',
      name: '7 bunte Fische',
      nameSearch: '7buntefische',
      source: 'ygoresources-git',
      syncedAt: SYNCED_AT,
    }).run()

    const resolved = resolveEntryLine(db, parseEntryLine('7 Bunte Fische'))

    expect(resolved).toMatchObject({ quantity: 1, query: '7 Bunte Fische' })
    expect(suggestCatalogMatches(db, resolved)[0]).toMatchObject({ cardId: 23771716, matchedBy: 'exact' })
  })
})

describe('normalizeCardName', () => {
  it('uses the shared folding, so ß and umlauts compare', () => {
    expect(normalizeCardName('Straße')).toBe('strasse')
    expect(normalizeCardName('STRASSE')).toBe('strasse')
    expect(normalizeCardName('Blauäugiger w. Drache')).toBe('blauaugigerwdrache')
  })
})

describe('parseSuggestRequest', () => {
  it('merges the text and item list into parsed lines', () => {
    const request = parseSuggestRequest({
      text: '2x Dark Magician\n\nPot of Greed',
      items: ['SDY-006'],
      limit: 3,
    })

    expect(request.lines.map(line => line.query)).toEqual(['Dark Magician', 'Pot of Greed', 'SDY-006'])
    expect(request.lines[0]!.quantity).toBe(2)
    expect(request.limit).toBe(3)
  })

  it('rejects payloads that exceed the line or size limits before parsing', () => {
    const tooManyLines = Array.from({ length: MAX_ENTRY_LINES + 1 }, (_, i) => `Card ${i}`).join('\n')

    expect(() => parseSuggestRequest({ text: tooManyLines })).toThrow()
    expect(() => parseSuggestRequest({ items: Array.from({ length: MAX_ENTRY_LINES + 1 }, () => 'Kuriboh') })).toThrow()
    expect(() => parseSuggestRequest({ text: 'a'.repeat(20_001) })).toThrow()
    expect(parseSuggestRequest({ text: Array.from({ length: MAX_ENTRY_LINES }, (_, i) => `Card ${i}`).join('\n') })
      .lines).toHaveLength(MAX_ENTRY_LINES)
  })

  it('rejects empty and malformed input', () => {
    expect(() => parseSuggestRequest({ text: '   \n\n' })).toThrow()
    expect(() => parseSuggestRequest({})).toThrow()
    expect(() => parseSuggestRequest('nope')).toThrow()
    expect(() => parseSuggestRequest({ items: [42] })).toThrow()
    expect(() => parseSuggestRequest({ text: 42 })).toThrow()
  })

  it('clamps the requested limit', () => {
    expect(parseSuggestLimit(undefined)).toBe(5)
    expect(parseSuggestLimit(3)).toBe(3)
    expect(parseSuggestLimit(500)).toBe(20)
    expect(() => parseSuggestLimit(0)).toThrow()
  })
})
