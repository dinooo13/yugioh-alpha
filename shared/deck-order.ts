// The order of the rows in a deck section, shared by the server (which sorts
// every deck response) and the deck editor (which slots an optimistic row in
// before the answer arrives, #148). Pure, no Vue, no Drizzle.
import { compareCardNames } from './card-text'
import type { AppLocale } from './locale'
import type { DeckSection } from './deck-sections'

/** Monsters first (0), then spells (1), then traps (2). */
export function cardCategoryRank(type: string): number {
  if (type.toLowerCase().includes('spell')) {
    return 1
  }
  if (type.toLowerCase().includes('trap')) {
    return 2
  }
  return 0
}

export interface DeckOrderRow {
  type: string
  name: string
  nameDe?: string | null
}

/**
 * The conventional deck-list order: the Main Deck by monsters / spells /
 * traps, then by name; Extra and Side by name. Names are compared in the
 * card language (ADR 0015).
 */
export function compareDeckRows(section: DeckSection, a: DeckOrderRow, b: DeckOrderRow, cardLocale: AppLocale): number {
  const byName = compareCardNames(a, b, cardLocale)
  return section === 'main' ? cardCategoryRank(a.type) - cardCategoryRank(b.type) || byName : byName
}
