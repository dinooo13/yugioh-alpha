import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { asc } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../server/db/schema'
import type { TranslationSyncDeps } from '../../server/utils/card-translations-sync'
import { refreshCatalog } from '../../server/utils/catalog-refresh'
import { darkMagicianFixture, potOfGreedFixture } from './fixtures/ygoprodeck-cards'
import { buildTarGz, streamOf } from './fixtures/tarball'
import { deFiles } from './fixtures/ygoresources-de'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

const SHA = 'c'.repeat(40)
const fetchAllCards = async () => [darkMagicianFixture, potOfGreedFixture]

describe('refreshCatalog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('syncs the cards, then the German card data with force', async () => {
    const db = createTestDb()
    const tarballs: string[] = []
    const deps: TranslationSyncDeps = {
      async fetchHeadSha() {
        return SHA
      },
      async fetchTarball(sha) {
        tarballs.push(sha)
        return streamOf(buildTarGz(deFiles()))
      },
    }

    const first = await refreshCatalog(db, { fetchAllCards, translations: { deps, minFiles: 1 } })
    // Same commit again: forced, so newly synced cards pick up their files.
    const second = await refreshCatalog(db, { fetchAllCards, translations: { deps, minFiles: 1 } })

    expect(first).toMatchObject({
      cardCount: 2,
      // Dark Magician (4041) has a German file; Pot of Greed (4844) doesn't.
      translations: { status: 'success', revision: SHA, rows: 1, cardsWithoutKonamiId: 0 },
    })
    expect(second.translations).toMatchObject({ status: 'success', rows: 1 })
    expect(tarballs).toEqual([SHA, SHA])
    expect(db.select({ name: schema.catalogCardTranslation.name }).from(schema.catalogCardTranslation).all())
      .toEqual([{ name: 'Dunkler Magier' }])
  })

  it('returns a successful card result when the translation sync fails', async () => {
    const db = createTestDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps: TranslationSyncDeps = {
      async fetchHeadSha() {
        throw new Error('GitHub API responded 503')
      },
      async fetchTarball() {
        throw new Error('not reached')
      },
    }

    const result = await refreshCatalog(db, { fetchAllCards, translations: { deps } })

    expect(result).toMatchObject({
      cardCount: 2,
      translations: { status: 'error', error: 'GitHub API responded 503' },
    })
    expect(warn).toHaveBeenCalledOnce()
    const runs = db.select().from(schema.catalogSync).orderBy(asc(schema.catalogSync.id)).all()
    expect(runs.map(run => [run.source, run.status])).toEqual([
      ['ygoprodeck', 'success'],
      ['ygoresources-git', 'error'],
    ])
    // The card sync stored the Konami ids the translation sync joins on.
    expect(db.select({ konamiId: schema.catalogCard.konamiId }).from(schema.catalogCard).all().map(row => row.konamiId).sort())
      .toEqual([4041, 4844])
  })

  it('propagates a card sync failure without running the translation sync', async () => {
    const db = createTestDb()
    const fetchHeadSha = vi.fn(async () => SHA)

    await expect(refreshCatalog(db, {
      fetchAllCards: async () => {
        throw new Error('YGOPRODeck down')
      },
      translations: { deps: { fetchHeadSha, fetchTarball: async () => streamOf(Buffer.alloc(0)) } },
    })).rejects.toThrow('YGOPRODeck down')
    expect(fetchHeadSha).not.toHaveBeenCalled()
  })
})
