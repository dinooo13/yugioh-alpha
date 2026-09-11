import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { CATALOG_FIXTURE_IDS, seedCatalogFixture } from '../../server/db/fixtures/catalog-fixture'
import * as schema from '../../server/db/schema'
import {
  extractCardCandidatesFromOcrText,
  parseEntryLine,
  parseEntryText,
  parseSuggestInput,
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
})

describe('parseEntryText', () => {
  it('parses one card per line and skips blank lines', () => {
    const parsed = parseEntryText('2x Dark Magician\n\n  \nPot of Greed\r\nSDY-006')

    expect(parsed).toHaveLength(3)
    expect(parsed.map(line => line.query)).toEqual(['Dark Magician', 'Pot of Greed', 'SDY-006'])
    expect(parsed[0]!.quantity).toBe(2)
  })
})

describe('extractCardCandidatesFromOcrText', () => {
  it('prioritizes set codes and passcodes, keeps plausible name lines, drops noise', () => {
    const candidates = extractCardCandidatesFromOcrText([
      '-- ~',
      'Dark Magician',
      '[SPELLCASTER / NORMAL]',
      'ATK/2500 DEF/2100',
      'SDY-006',
      '46986414',
      'Dark Magician',
      '1996 KAZUKI TAKAHASHI',
    ].join('\n'))

    expect(candidates[0]).toBe('SDY-006')
    expect(candidates[1]).toBe('46986414')
    expect(candidates).toContain('Dark Magician')
    // Deduplicated (case-insensitively), and pure stat/symbol lines dropped.
    expect(candidates.filter(candidate => candidate === 'Dark Magician')).toHaveLength(1)
    expect(candidates).not.toContain('ATK/2500 DEF/2100')
    expect(candidates).not.toContain('-- ~')
  })

  it('returns an empty list for unusable output', () => {
    expect(extractCardCandidatesFromOcrText('\n***\n12\n')).toEqual([])
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
})

describe('parseSuggestInput', () => {
  it('merges text, item list, and OCR text into parsed lines', () => {
    const lines = parseSuggestInput({
      text: '2x Dark Magician\n\nPot of Greed',
      items: ['SDY-006'],
      ocrText: 'Kuriboh\nATK/300 DEF/200',
    })

    expect(lines.map(line => line.query)).toEqual(['Dark Magician', 'Pot of Greed', 'SDY-006', 'Kuriboh'])
    expect(lines[0]!.quantity).toBe(2)
  })

  it('caps the input at 200 lines', () => {
    const lines = parseSuggestInput({ text: Array.from({ length: 250 }, (_, i) => `Card ${i}`).join('\n') })

    expect(lines).toHaveLength(200)
  })

  it('rejects empty and malformed input', () => {
    expect(() => parseSuggestInput({ text: '   \n\n' })).toThrow()
    expect(() => parseSuggestInput({})).toThrow()
    expect(() => parseSuggestInput('nope')).toThrow()
    expect(() => parseSuggestInput({ items: [42] })).toThrow()
  })
})
