// The card-kind breakdown of a deck (owner feedback in #148): the deck
// editor's header chips, the shared deck view and the deck tiles. Pure, no
// Vue; the server computes it for the deck lists.
import { cardFrame } from './card-frame'

/** Display order of the chips: Main Deck kinds, then Extra Deck kinds. */
export const DECK_CARD_KINDS = ['normal', 'effect', 'ritual', 'spell', 'trap', 'fusion', 'synchro', 'xyz', 'link', 'other'] as const
export type DeckCardKind = typeof DECK_CARD_KINDS[number]

export interface DeckBreakdownRow {
  type?: string | null
  frameType?: string | null
  quantity: number
}

export interface DeckBreakdownGroup {
  section: 'main' | 'extra'
  kinds: Array<{ kind: DeckCardKind, count: number }>
}

/** A card's kind by its frame; Pendulum monsters count by their base frame, tokens/skills/unknown as `other`. */
export function deckCardKind(card: { type?: string | null, frameType?: string | null }): DeckCardKind {
  const frame = cardFrame(card)?.frame
  return frame && frame !== 'token' && frame !== 'skill' ? frame : 'other'
}

/** Copies (the sum of `quantity`) per kind in the chip order; kinds without copies are left out. */
export function deckKindBreakdown(rows: ReadonlyArray<DeckBreakdownRow>): Array<{ kind: DeckCardKind, count: number }> {
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

/** Main then Extra; groups without copies are left out. The Side Deck is never counted. */
export function deckBreakdownGroups(sections: {
  main: ReadonlyArray<DeckBreakdownRow>
  extra: ReadonlyArray<DeckBreakdownRow>
}): DeckBreakdownGroup[] {
  return (['main', 'extra'] as const)
    .map(section => ({ section, kinds: deckKindBreakdown(sections[section]) }))
    .filter(group => group.kinds.length > 0)
}
