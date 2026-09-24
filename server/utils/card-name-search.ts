// Bilingual card name search (ADR 0015, F3b of #34): one place that turns a
// user's search term into the WHERE clause every card search uses — the
// catalog, the inventory, wishlists, shared views, the deck list and the
// assistant's search tools.
//
// A name matches in any language, whatever the display language:
//
// 1. the raw English `catalog_card.name` (`LIKE`, escaped) — the old search,
//    and the fallback for rows whose `name_search` is still `''`;
// 2. the folded English `catalog_card.name_search`;
// 3. the folded `catalog_card_translation.name_search` (German), read from
//    the covering index `idx_catalog_card_translation_search`.
//
// Folding (`foldCardName`) makes "BLAUÄUGIGER", "blauaugiger" and
// "Blauäugiger" equal, and "blue eyes" find "Blue-Eyes". A term that folds to
// `''` (only punctuation, `%`, …) skips the folded columns.
//
// The SQL references `catalog_card` by its table name, so the outer query
// must select from or join `catalog_card` unaliased.

import { or, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { foldCardName } from '../../shared/card-name-fold'
import { catalogCard, catalogCardTranslation } from '../db/schema'

/** Escapes SQLite `LIKE` wildcards so a user's search term matches literally. */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`)
}

/** `column LIKE pattern ESCAPE '\'` — the pattern must already be escaped. */
export function escapedLike(column: AnySQLiteColumn | SQL, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`
}

/**
 * Matches `catalog_card` rows whose English or German name contains `query`
 * (a substring; case, accents, spaces and punctuation don't matter for the
 * folded forms). `query` should be trimmed and non-empty.
 */
export function cardNameMatches(query: string): SQL {
  const clauses: SQL[] = [escapedLike(catalogCard.name, `%${escapeLikeTerm(query)}%`)]

  const folded = foldCardName(query)
  if (folded !== '') {
    // Folded values never contain `%` or `_`: no escaping needed.
    const pattern = `%${folded}%`
    clauses.push(
      sql`${catalogCard.nameSearch} LIKE ${pattern}`,
      sql`${catalogCard.id} IN (
        select ${catalogCardTranslation.cardId} from ${catalogCardTranslation}
        where ${catalogCardTranslation.nameSearch} LIKE ${pattern}
      )`,
    )
  }

  return or(...clauses)!
}

/**
 * Matches `catalog_card` rows whose English or German card text contains
 * `query` (raw `LIKE`: case-insensitive for ASCII only, so German umlauts
 * stay case-sensitive — ADR 0015). Combine with `cardNameMatches` for
 * "search in card text too".
 */
export function cardTextMatches(query: string): SQL {
  const pattern = `%${escapeLikeTerm(query)}%`

  return or(
    escapedLike(catalogCard.desc, pattern),
    sql`${catalogCard.id} IN (
      select ${catalogCardTranslation.cardId} from ${catalogCardTranslation}
      where ${catalogCardTranslation.desc} LIKE ${pattern} ESCAPE '\\'
    )`,
  )!
}
