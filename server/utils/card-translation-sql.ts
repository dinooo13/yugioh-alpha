// German card names and texts in card queries (ADR 0015, F3c of #34).
//
// Payloads keep `name` / `desc` as the canonical English values and always
// add `nameDe` (and `descDe` in detail views), whoever asks; the client picks
// what to show (`useCardText()`). These helpers read the German values from
// `catalog_card_translation` by its primary key `(card_id, locale)`.
//
// Like `card-name-search.ts`, the default card-id column is
// `catalog_card.id` by its table name, so a query that uses the defaults must
// select from or join `catalog_card` unaliased.

import { sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { AppLocale } from '../../shared/locale'
import { catalogCard, catalogCardTranslation } from '../db/schema'

/** The German name of the card `cardId` points at, or `null` (a scalar subquery on the primary key). */
export function cardNameDeSql(cardId: AnySQLiteColumn | SQL = catalogCard.id): SQL<string | null> {
  return sql<string | null>`(
    select ${catalogCardTranslation.name} from ${catalogCardTranslation}
    where ${catalogCardTranslation.cardId} = ${cardId} and ${catalogCardTranslation.locale} = 'de'
  )`
}

/** The German card text of the card `cardId` points at, or `null`. */
export function cardDescDeSql(cardId: AnySQLiteColumn | SQL = catalogCard.id): SQL<string | null> {
  return sql<string | null>`(
    select ${catalogCardTranslation.desc} from ${catalogCardTranslation}
    where ${catalogCardTranslation.cardId} = ${cardId} and ${catalogCardTranslation.locale} = 'de'
  )`
}

/**
 * The sort key for "by card name" in the given card language. English sorts
 * by `catalog_card.name`, as before. German sorts by the folded German name
 * (case, umlauts and punctuation don't matter), falling back to the folded
 * English name for cards without one (`lower(name)` while `name_search` is
 * still being backfilled).
 */
export function cardSortKey(locale: AppLocale, cardId: AnySQLiteColumn | SQL = catalogCard.id): SQL {
  if (locale === 'en') {
    return sql`${catalogCard.name}`
  }
  return sql`coalesce(
    (
      select ${catalogCardTranslation.nameSearch} from ${catalogCardTranslation}
      where ${catalogCardTranslation.cardId} = ${cardId} and ${catalogCardTranslation.locale} = 'de'
    ),
    nullif(${catalogCard.nameSearch}, ''),
    lower(${catalogCard.name})
  )`
}
