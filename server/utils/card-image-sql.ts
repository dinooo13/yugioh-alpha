// A card's primary artwork (ADR 0025): the image whose id is the card's id
// (YGOPRODeck's main art, the passcode printed on the card), else the lowest
// image id. Every list, cover and the card detail use it, so a card shows the
// same picture everywhere.
//
// Like card-translation-sql.ts, the default card-id column is `catalog_card.id`
// by its table name: a query using the default selects from or joins
// `catalog_card` unaliased and does not join `catalog_card_image` itself.
//
// The subquery is a nested `sql` chunk on purpose: in a single-table select
// drizzle writes the selection's top-level column chunks without their table
// name, and an unqualified `id` inside the subquery would be the image's id.

import { asc, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { catalogCard, catalogCardImage } from '../db/schema'

/** ORDER BY for one card's images: the primary artwork first, then by id. */
export function primaryImageFirst(): SQL[] {
  return [sql`(${catalogCardImage.id} = ${catalogCardImage.cardId}) desc`, asc(catalogCardImage.id)]
}

/** A URL column of the card's primary artwork, or null without an image (a scalar subquery on `idx_image_card`). */
export function primaryImageUrlSql(
  column: 'imageUrl' | 'imageUrlSmall',
  cardId: AnySQLiteColumn | SQL = catalogCard.id,
): SQL<string | null> {
  const subquery = sql`select ${catalogCardImage[column]} from ${catalogCardImage}
    where ${catalogCardImage.cardId} = ${cardId}
    order by ${sql.join(primaryImageFirst(), sql`, `)}
    limit 1`
  return sql<string | null>`(${subquery})`
}
