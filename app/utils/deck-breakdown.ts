// The deck header's card-kind breakdown (owner feedback in #148). Pure, no Vue.
import { cardFrame } from '~/utils/card-frame'

/** Display order of the header chips: Main Deck kinds, then Extra Deck kinds. */
export const DECK_CARD_KINDS = ['normal', 'effect', 'ritual', 'spell', 'trap', 'fusion', 'synchro', 'xyz', 'link', 'other'] as const
export type DeckCardKind = typeof DECK_CARD_KINDS[number]

/** A card's kind by its frame; Pendulum monsters count by their base frame, tokens/skills/unknown as `other`. */
export function deckCardKind(card: { type?: string | null, frameType?: string | null }): DeckCardKind {
  const frame = cardFrame(card)?.frame
  return frame && frame !== 'token' && frame !== 'skill' ? frame : 'other'
}

/** Copies (the sum of `quantity`) per kind in the chip order; kinds without copies are left out. */
export function deckKindBreakdown(rows: ReadonlyArray<{ type: string, frameType: string | null, quantity: number }>): Array<{ kind: DeckCardKind, count: number }> {
  const counts = new Map<DeckCardKind, number>()
  for (const row of rows) {
    const kind = deckCardKind(row)
    counts.set(kind, (counts.get(kind) ?? 0) + row.quantity)
  }
  return DECK_CARD_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0
    return count > 0 ? [{ kind, count }] : []
  })
}
