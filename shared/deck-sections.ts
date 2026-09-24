// Pure deck-section rules, shared by the server (server/utils/decks.ts) and
// the deckbuilder UI (app/pages/decks/**) so both agree on which section a
// card may live in. Intentionally dependency-free: no Drizzle, no h3, no Vue.

export const DECK_SECTIONS = ['main', 'extra', 'side'] as const

export type DeckSection = typeof DECK_SECTIONS[number]

export interface DeckSectionCard {
  type?: string | null
  frameType?: string | null
}

/**
 * Structural deck limits (standard Yu-Gi-Oh construction rules).
 *
 * These are reported as *warnings* rather than enforced as errors: Phase 4
 * rule formats will make deck sizes and copy limits configurable, so the
 * deckbuilder must let a user park an over-/under-sized work in progress.
 */
export const DECK_LIMITS = {
  mainMin: 40,
  mainMax: 60,
  extraMax: 15,
  sideMax: 15,
  // Copies of one catalog card across the whole deck (main + extra + side).
  maxCopies: 3,
} as const

// YGOPRODeck card types/frame types that identify an Extra Deck monster
// ("Fusion Monster", "Synchro Tuner Monster", "XYZ Monster", "Link Monster",
// including their Pendulum variants).
const EXTRA_DECK_MARKERS = ['fusion', 'synchro', 'xyz', 'link'] as const

export function isExtraDeckCard(card: DeckSectionCard): boolean {
  const haystack = `${card.type ?? ''} ${card.frameType ?? ''}`.toLowerCase()
  return EXTRA_DECK_MARKERS.some(marker => haystack.includes(marker))
}

/** The section a card lands in when no explicit section was chosen. */
export function defaultSectionForCard(card: DeckSectionCard): DeckSection {
  return isExtraDeckCard(card) ? 'extra' : 'main'
}

/** The sections a card may be placed in; 'side' accepts every card. */
export function allowedSectionsForCard(card: DeckSectionCard): DeckSection[] {
  return isExtraDeckCard(card) ? ['extra', 'side'] : ['main', 'side']
}

export function isSectionAllowedForCard(card: DeckSectionCard, section: DeckSection): boolean {
  return allowedSectionsForCard(card).includes(section)
}

export const DECK_NAME_MAX_LENGTH = 80
export const DECK_DESCRIPTION_MAX_LENGTH = 500
