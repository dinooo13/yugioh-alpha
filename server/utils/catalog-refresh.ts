import type { useDb } from '../db'
import { syncCardTranslations, type TranslationSyncOptions, type TranslationSyncResult } from './card-translations-sync'
import { syncCatalog, type CatalogSyncResult } from './catalog-sync'
import type { fetchAllCards } from './ygoprodeck'

type Db = ReturnType<typeof useDb>

export interface CatalogRefreshResult extends CatalogSyncResult {
  /** The German card data sync that follows the card sync (ADR 0015); best effort. */
  translations: TranslationSyncResult | { status: 'error', error: string }
}

/** Injection points for tests; production uses the real network clients. */
export interface CatalogRefreshOptions {
  fetchAllCards?: typeof fetchAllCards
  translations?: Omit<TranslationSyncOptions, 'force'>
}

/**
 * The full catalog refresh behind `catalog:sync` and `POST
 * /api/admin/catalog/sync`: the YGOPRODeck card sync (ADR 0001), then the
 * German card data sync (ADR 0015).
 *
 * The translation sync runs with `force`: cards the card sync just added may
 * have German files at an unchanged commit. It is best effort — a failure is
 * logged and reported under `translations`, but the card result stands.
 */
export async function refreshCatalog(db: Db, options: CatalogRefreshOptions = {}): Promise<CatalogRefreshResult> {
  const cardResult = await syncCatalog(db, options.fetchAllCards ? { fetchAllCards: options.fetchAllCards } : undefined)

  let translations: CatalogRefreshResult['translations']
  try {
    translations = await syncCardTranslations(db, { ...options.translations, force: true })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[catalog] German card data sync failed: ${message}`)
    translations = { status: 'error', error: message }
  }

  return { ...cardResult, translations }
}
