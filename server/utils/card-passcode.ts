// Printed passcodes (ADR 0023). YGOPRODeck keeps a card's alternate artworks
// as image rows with their own passcode: Dark Magician is card 46986420, and
// the passcode printed on the original card, 46986414, is one of its
// artworks. A lookup by id that finds no card row falls back to the card
// that lists an artwork with that id; a card row always wins.
//
// Only lookups alias (the card detail, quick entry, the inventory's card
// picker). Writes (inventory, decks, wishlist) take canonical card ids.

import { eq } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard, catalogCardImage } from '../db/schema'

type Db = ReturnType<typeof useDb>

function cardRow(db: Db, id: number) {
  return db
    .select({ id: catalogCard.id, retiredAt: catalogCard.retiredAt, replacedById: catalogCard.replacedById })
    .from(catalogCard)
    .where(eq(catalogCard.id, id))
    .get()
}

function artworkCardId(db: Db, id: number): number | null {
  const image = db
    .select({ cardId: catalogCardImage.cardId })
    .from(catalogCardImage)
    .where(eq(catalogCardImage.id, id))
    .get()
  return image?.cardId ?? null
}

/**
 * The catalog card `id` names: the card row with that id (active **or**
 * retired, ADR 0019), else the card that lists an artwork with that id,
 * else `null`.
 */
export function resolveCatalogCardId(db: Db, id: number): number | null {
  if (cardRow(db, id)) {
    return id
  }
  return artworkCardId(db, id)
}

/**
 * The card a printed passcode stands for today: `resolveCatalogCardId`, then
 * a retired card with a replacement resolves to the replacement (a
 * renumbered card, ADR 0019). A retired card without one resolves to
 * itself; catalog-wide searches filter it out. `null` for an unknown id.
 */
export function resolvePasscode(db: Db, passcode: number): number | null {
  const row = cardRow(db, passcode) ?? (() => {
    const cardId = artworkCardId(db, passcode)
    return cardId === null ? undefined : cardRow(db, cardId)
  })()
  if (!row) {
    return null
  }
  return row.retiredAt !== null && row.replacedById !== null ? row.replacedById : row.id
}
