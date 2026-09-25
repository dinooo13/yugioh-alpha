// Level, Rank or Link rating of a card, with Konami's official words (#101):
// Xyz monsters store their rank in `level`; Link monsters have `linkval` and
// no level.
export type CardLevelKind = 'level' | 'rank' | 'link'

export interface CardLevelFields {
  type: string
  level: number | null
  /** The card detail and the card list payloads carry it. */
  linkval?: number | null
}

export interface CardLevel { kind: CardLevelKind, value: number }

/**
 * The card's level, rank or link rating, or null when it has none. A Link
 * monster without `linkval` has none. Level 0 and Rank 0 are real values.
 */
export function cardLevel(card: CardLevelFields): CardLevel | null {
  if (/\blink\b/i.test(card.type)) {
    return card.linkval == null ? null : { kind: 'link', value: card.linkval }
  }
  if (card.level === null) {
    return null
  }
  return { kind: /\bxyz\b/i.test(card.type) ? 'rank' : 'level', value: card.level }
}

/** Icon per kind: the star for Level and Rank (as on the card frame), a link icon for Link. */
export const CARD_LEVEL_ICON: Record<CardLevelKind, string> = {
  level: 'i-lucide-star',
  rank: 'i-lucide-star',
  link: 'i-lucide-link',
}
