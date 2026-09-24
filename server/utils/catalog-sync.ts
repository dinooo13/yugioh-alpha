import { eq } from 'drizzle-orm'
import { foldCardName } from '../../shared/card-name-fold'
import type { useDb } from '../db'
import { catalogCard, catalogCardImage, catalogPrinting, catalogSet, catalogSync } from '../db/schema'
import { fetchAllCards, mapCardToRows, type MappedCard } from './ygoprodeck'

type Db = ReturnType<typeof useDb>

// Cards are upserted in chunks so each transaction stays small and a
// failure partway through a sync doesn't hold one giant transaction open.
const CHUNK_SIZE = 500

export interface CatalogSyncResult {
  runId: number
  cardCount: number
}

export function chunkRows<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function upsertChunk(db: Db, mapped: MappedCard[]) {
  db.transaction((tx) => {
    // Dedupe sets within the chunk (many cards share a set name).
    const setsById = new Map<string, { id: string, name: string }>()
    for (const { sets } of mapped) {
      for (const set of sets) {
        setsById.set(set.id, set)
      }
    }

    for (const cardRow of mapped.map(m => m.card)) {
      tx.insert(catalogCard)
        .values(cardRow)
        .onConflictDoUpdate({ target: catalogCard.id, set: cardRow })
        .run()
    }

    for (const set of setsById.values()) {
      tx.insert(catalogSet)
        .values(set)
        .onConflictDoUpdate({ target: catalogSet.id, set: { name: set.name } })
        .run()
    }

    for (const printing of mapped.flatMap(m => m.printings)) {
      tx.insert(catalogPrinting)
        .values(printing)
        .onConflictDoUpdate({ target: catalogPrinting.id, set: printing })
        .run()
    }

    for (const image of mapped.flatMap(m => m.images)) {
      tx.insert(catalogCardImage)
        .values(image)
        .onConflictDoUpdate({ target: catalogCardImage.id, set: image })
        .run()
    }
  })
}

/**
 * Runs a full catalog sync: fetches every card from YGOPRODeck and upserts
 * it into the local catalog tables, in chunks, recording a `catalog_sync`
 * run so the outcome is observable. Idempotent — re-running converges to
 * the same rows rather than creating duplicates.
 */
export async function syncCatalog(
  db: Db,
  deps: { fetchAllCards: typeof fetchAllCards } = { fetchAllCards },
): Promise<CatalogSyncResult> {
  const startedAt = new Date()
  const [run] = db
    .insert(catalogSync)
    .values({ startedAt, status: 'running' })
    .returning()
    .all()
  if (!run) {
    throw new Error('Failed to create catalog_sync run row')
  }

  try {
    const cards = await deps.fetchAllCards()
    const syncedAt = new Date()
    const mapped = cards.map(card => mapCardToRows(card, syncedAt))

    for (const batch of chunkRows(mapped, CHUNK_SIZE)) {
      upsertChunk(db, batch)
    }

    db.update(catalogSync)
      .set({ status: 'success', cardCount: cards.length, finishedAt: new Date() })
      .where(eq(catalogSync.id, run.id))
      .run()

    return { runId: run.id, cardCount: cards.length }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.update(catalogSync)
      .set({ status: 'error', error: message, finishedAt: new Date() })
      .where(eq(catalogSync.id, run.id))
      .run()
    throw error
  }
}

/**
 * Fills `catalog_card.name_search` for rows that don't have it yet (ADR
 * 0015): the column arrived with migration 0012 as `''`, and cards inserted
 * without it (tests, old fixtures) stay `''` too. Runs at startup after the
 * migrations, in one transaction; a no-op once every row is folded. Returns
 * the number of rows updated.
 *
 * `konami_id` is not backfilled here — it only comes with the next
 * `catalog:sync` run.
 */
export function backfillCatalogNameSearch(db: Db): number {
  const rows = db
    .select({ id: catalogCard.id, name: catalogCard.name })
    .from(catalogCard)
    .where(eq(catalogCard.nameSearch, ''))
    .all()

  let updated = 0
  db.transaction((tx) => {
    for (const row of rows) {
      const nameSearch = foldCardName(row.name)
      // A name that folds to '' (punctuation only) stays '' — the raw `LIKE`
      // on `name` still finds it.
      if (nameSearch === '') {
        continue
      }
      tx.update(catalogCard).set({ nameSearch }).where(eq(catalogCard.id, row.id)).run()
      updated += 1
    }
  })
  return updated
}
