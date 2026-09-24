/**
 * The card shown as a deck's cover image on deck tiles (#29).
 *
 * Chosen by the user (`deck.cover_card_id`, #49) while that card is in the
 * Main/Extra Deck; otherwise picked by rule: the first-added Main Deck monster
 * (by `deck_card.created_at`, ties broken by the lower catalog card id), else
 * the first-added Main Deck card of any kind, else the first-added Extra Deck
 * card. The Side Deck is never used. A deck without Main or Extra Deck cards
 * has no cover (`null`).
 */
export interface DeckCover {
  catalogCardId: number
  name: string
  /** Official German name (ADR 0015); null when there is none. */
  nameDe: string | null
  imageSmall: string | null
  imageLarge: string | null
}
