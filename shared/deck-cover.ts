/**
 * The card shown as a deck's cover image on deck tiles (#29).
 *
 * Picked by rule, not chosen by the user: the first-added Main Deck monster
 * (by `deck_card.created_at`, ties broken by the lower catalog card id), else
 * the first-added Main Deck card of any kind, else the first-added Extra Deck
 * card. The Side Deck is never used. A deck without Main or Extra Deck cards
 * has no cover (`null`).
 */
export interface DeckCover {
  catalogCardId: number
  name: string
  imageSmall: string | null
  imageLarge: string | null
}
