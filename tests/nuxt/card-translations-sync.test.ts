import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { asc, eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { CATALOG_FIXTURE_IDS, CATALOG_FIXTURE_TRANSLATIONS } from '../../server/db/fixtures/catalog-fixture'
import {
  parseTranslationFile,
  syncCardTranslations,
  type TranslationSyncDeps,
} from '../../server/utils/card-translations-sync'
import { buildTarGz, streamOf } from './fixtures/tarball'
import { deFiles, deOddEyesPendulumDragon } from './fixtures/ygoresources-de'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type Db = ReturnType<typeof createTestDb>

const SHA_1 = 'a'.repeat(40)
const SHA_2 = 'b'.repeat(40)

const DARK_MAGICIAN = 46986414
// Dark Magician's alternate artwork has its own passcode but the same Konami id.
const DARK_MAGICIAN_ALT = 36996508
const BLUE_EYES = 89631139
const ODD_EYES = 16178681
const POT_OF_GREED = 55144522
const NO_KONAMI_ID = 12580477

function insertCard(db: Db, id: number, name: string, konamiId: number | null) {
  db.insert(schema.catalogCard)
    .values({ id, name, type: 'Normal Monster', desc: `${name} text`, syncedAt: new Date(0), konamiId })
    .run()
}

function seedCards(db: Db) {
  insertCard(db, DARK_MAGICIAN, 'Dark Magician', 4041)
  insertCard(db, DARK_MAGICIAN_ALT, 'Dark Magician', 4041)
  insertCard(db, BLUE_EYES, 'Blue-Eyes White Dragon', 4007)
  insertCard(db, ODD_EYES, 'Odd-Eyes Pendulum Dragon', 11213)
  // Has a Konami id, but no German file.
  insertCard(db, POT_OF_GREED, 'Pot of Greed', 4844)
  insertCard(db, NO_KONAMI_ID, 'Raigeki', null)
}

function fakeDeps(sha: string, files: Record<string, string> = deFiles()) {
  const calls = { head: 0, tarball: [] as string[] }
  const deps: TranslationSyncDeps = {
    async fetchHeadSha() {
      calls.head += 1
      return sha
    },
    async fetchTarball(requested) {
      calls.tarball.push(requested)
      return streamOf(buildTarGz(files, `yugioh-card-history-${requested}`))
    },
  }
  return { deps, calls }
}

function translations(db: Db) {
  return db
    .select()
    .from(schema.catalogCardTranslation)
    .orderBy(asc(schema.catalogCardTranslation.cardId))
    .all()
}

function translationFor(db: Db, cardId: number) {
  return db
    .select()
    .from(schema.catalogCardTranslation)
    .where(eq(schema.catalogCardTranslation.cardId, cardId))
    .get()
}

function runs(db: Db) {
  return db.select().from(schema.catalogSync).orderBy(asc(schema.catalogSync.id)).all()
}

describe('syncCardTranslations', () => {
  let db: Db

  beforeEach(() => {
    db = createTestDb()
    seedCards(db)
  })

  it('maps German names and texts onto every passcode of a Konami id', async () => {
    const { deps, calls } = fakeDeps(SHA_1)

    const result = await syncCardTranslations(db, { deps, minFiles: 1 })

    expect(calls.tarball).toEqual([SHA_1])
    expect(result).toMatchObject({
      status: 'success',
      revision: SHA_1,
      files: 5,
      invalidFiles: 1,
      unmappedFiles: 1,
      // Dark Magician ×2, Blue-Eyes, Odd-Eyes.
      rows: 4,
      cardsWithoutKonamiId: 1,
    })

    expect(translations(db).map(row => row.cardId)).toEqual(
      [DARK_MAGICIAN_ALT, DARK_MAGICIAN, BLUE_EYES, ODD_EYES].sort((a, b) => a - b),
    )
    expect(translationFor(db, DARK_MAGICIAN)).toMatchObject({
      locale: 'de',
      name: 'Dunkler Magier',
      nameSearch: 'dunklermagier',
      desc: 'Der ultimative Hexer im Hinblick auf Angriff und Verteidigung.',
      source: 'ygoresources-git',
    })
    expect(translationFor(db, DARK_MAGICIAN_ALT)).toMatchObject({ name: 'Dunkler Magier', nameSearch: 'dunklermagier' })
    // Folded search name, and \r\n normalized.
    expect(translationFor(db, BLUE_EYES)).toMatchObject({
      name: 'Blauäugiger w. Drache',
      nameSearch: 'blauaugigerwdrache',
      desc: 'Dieser legendäre Drache ist eine mächtige Zerstörungsmaschine.\nEr ist buchstäblich unbesiegbar.',
    })
    expect(translationFor(db, ODD_EYES)!.desc).toBe(
      `[ Pendeleffekt ]\n${deOddEyesPendulumDragon.pendEffect}\n\n[ Monstereffekt ]\n${deOddEyesPendulumDragon.effectText}`,
    )
    expect(translationFor(db, POT_OF_GREED)).toBeUndefined()

    expect(runs(db)).toEqual([
      expect.objectContaining({
        id: result.runId,
        source: 'ygoresources-git',
        status: 'success',
        revision: SHA_1,
        cardCount: 4,
        error: null,
      }),
    ])
    expect(runs(db)[0]!.finishedAt).not.toBeNull()
  })

  it('converges to the same rows when re-run', async () => {
    await syncCardTranslations(db, { deps: fakeDeps(SHA_1).deps, minFiles: 1 })
    const first = translations(db).map(({ syncedAt: _syncedAt, ...row }) => row)

    const again = await syncCardTranslations(db, { deps: fakeDeps(SHA_2).deps, minFiles: 1 })
    const forced = await syncCardTranslations(db, { deps: fakeDeps(SHA_2).deps, minFiles: 1, force: true })

    expect(again.status).toBe('success')
    expect(forced.status).toBe('success')
    expect(translations(db).map(({ syncedAt: _syncedAt, ...row }) => row)).toEqual(first)
  })

  it('deletes the rows of a file that disappeared upstream', async () => {
    await syncCardTranslations(db, { deps: fakeDeps(SHA_1).deps, minFiles: 1 })
    expect(translationFor(db, BLUE_EYES)).toBeDefined()

    const result = await syncCardTranslations(db, { deps: fakeDeps(SHA_2, deFiles({ 4007: null })).deps, minFiles: 1 })

    expect(result.rows).toBe(3)
    expect(translationFor(db, BLUE_EYES)).toBeUndefined()
    expect(translationFor(db, DARK_MAGICIAN)).toBeDefined()
    expect(translationFor(db, ODD_EYES)).toBeDefined()
  })

  it('skips an unchanged commit without downloading anything', async () => {
    await syncCardTranslations(db, { deps: fakeDeps(SHA_1).deps, minFiles: 1 })
    const { deps, calls } = fakeDeps(SHA_1)

    const result = await syncCardTranslations(db, { deps, minFiles: 1 })

    expect(result).toMatchObject({ status: 'skipped', revision: SHA_1, files: 0, rows: 0 })
    expect(calls.head).toBe(1)
    expect(calls.tarball).toEqual([])
    expect(runs(db).map(run => [run.status, run.revision])).toEqual([
      ['success', SHA_1],
      ['skipped', SHA_1],
    ])
    expect(translations(db)).toHaveLength(4)
  })

  it('imports an unchanged commit again when forced', async () => {
    await syncCardTranslations(db, { deps: fakeDeps(SHA_1).deps, minFiles: 1 })
    const { deps, calls } = fakeDeps(SHA_1)

    const result = await syncCardTranslations(db, { deps, minFiles: 1, force: true })

    expect(result.status).toBe('success')
    expect(calls.tarball).toEqual([SHA_1])
  })

  it('records an error and keeps the old rows when the head SHA request fails', async () => {
    await syncCardTranslations(db, { deps: fakeDeps(SHA_1).deps, minFiles: 1 })
    const deps: TranslationSyncDeps = {
      async fetchHeadSha() {
        throw new Error('GitHub API responded 403')
      },
      async fetchTarball() {
        throw new Error('not reached')
      },
    }

    await expect(syncCardTranslations(db, { deps, minFiles: 1 })).rejects.toThrow('GitHub API responded 403')

    expect(runs(db).at(-1)).toMatchObject({ status: 'error', error: 'GitHub API responded 403', revision: null })
    expect(translations(db)).toHaveLength(4)
  })

  it('writes and deletes nothing when the archive has too few files', async () => {
    await syncCardTranslations(db, { deps: fakeDeps(SHA_1).deps, minFiles: 1 })
    const before = translations(db)

    await expect(
      syncCardTranslations(db, { deps: fakeDeps(SHA_2, deFiles({ 4007: null, 11213: null })).deps, minFiles: 3 }),
    ).rejects.toThrow('archive looks incomplete')

    expect(translations(db)).toEqual(before)
    expect(runs(db).at(-1)).toMatchObject({ status: 'error', revision: null })
  })

  it('writes and deletes nothing when the download breaks off', async () => {
    await syncCardTranslations(db, { deps: fakeDeps(SHA_1).deps, minFiles: 1 })
    const before = translations(db)
    const archive = buildTarGz(deFiles())
    const deps: TranslationSyncDeps = {
      async fetchHeadSha() {
        return SHA_2
      },
      async fetchTarball() {
        return streamOf(archive.subarray(0, archive.length - 40))
      },
    }

    await expect(syncCardTranslations(db, { deps, minFiles: 1 })).rejects.toThrow()

    expect(translations(db)).toEqual(before)
    expect(runs(db).at(-1)!.status).toBe('error')
  })

  it('fails before downloading when the catalog has no Konami ids', async () => {
    db.update(schema.catalogCard).set({ konamiId: null }).run()
    const { deps, calls } = fakeDeps(SHA_1)

    await expect(syncCardTranslations(db, { deps, minFiles: 1 })).rejects.toThrow('catalog has no konami ids; run catalog:sync first')

    expect(calls.tarball).toEqual([])
    expect(runs(db)).toEqual([expect.objectContaining({ status: 'error', revision: null })])

    // A later run with Konami ids is not skipped: no revision was recorded.
    db.update(schema.catalogCard).set({ konamiId: 4041 }).where(eq(schema.catalogCard.id, DARK_MAGICIAN)).run()
    const retry = await syncCardTranslations(db, { deps: fakeDeps(SHA_1).deps, minFiles: 1 })
    expect(retry.status).toBe('success')
  })
})

describe('parseTranslationFile', () => {
  it('rejects files that are not card JSON', () => {
    expect(parseTranslationFile('{')).toBeNull()
    expect(parseTranslationFile('[]')).toBeNull()
    expect(parseTranslationFile('null')).toBeNull()
    expect(parseTranslationFile(JSON.stringify({ name: '  ' }))).toBeNull()
    expect(parseTranslationFile(JSON.stringify({ name: 42 }))).toBeNull()
    expect(parseTranslationFile(JSON.stringify({ name: 'X', effectText: 7 }))).toBeNull()
    expect(parseTranslationFile(JSON.stringify({ name: 'X', pendEffect: ['a'] }))).toBeNull()
  })

  it('accepts a card without text', () => {
    expect(parseTranslationFile(JSON.stringify({ name: 'Spielmarke' }))).toEqual({ name: 'Spielmarke', desc: null })
  })

  it('produces exactly the German text the catalog fixture carries', () => {
    const fixture = CATALOG_FIXTURE_TRANSLATIONS.find(row => row.cardId === CATALOG_FIXTURE_IDS.oddEyesPendulumDragon)!
    expect(parseTranslationFile(JSON.stringify(deOddEyesPendulumDragon))).toEqual({ name: fixture.name, desc: fixture.desc })
  })
})
