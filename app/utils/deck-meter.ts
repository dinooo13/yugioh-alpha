import { DECK_LIMITS } from '~~/shared/deck-sections'
import type { DeckSection } from '~~/shared/deck-sections'

export interface DeckLimits {
  mainMin: number
  mainMax: number
  extraMax: number
  sideMax: number
}

export type DeckCountState = 'under' | 'over' | 'ok' | 'none'

/**
 * Where a section's card count stands against the deck limits: `under`
 * (only the Main Deck has a minimum), `over`, `ok` (a legal Main Deck size)
 * or `none` (an Extra/Side Deck within its maximum).
 */
export function deckCountState(section: DeckSection, count: number, limits: DeckLimits = DECK_LIMITS): DeckCountState {
  if (section === 'main') {
    if (count > limits.mainMax) {
      return 'over'
    }
    return count < limits.mainMin ? 'under' : 'ok'
  }
  const max = section === 'extra' ? limits.extraMax : limits.sideMax
  return count > max ? 'over' : 'none'
}

/**
 * The share of a section's meter to fill (0–100): the Main Deck against its
 * minimum (a legal deck reads as full), Extra and Side against their maximum.
 */
export function deckMeterFill(section: DeckSection, count: number, limits: DeckLimits = DECK_LIMITS): number {
  const target = section === 'main' ? limits.mainMin : section === 'extra' ? limits.extraMax : limits.sideMax
  if (target <= 0) {
    return count > 0 ? 100 : 0
  }
  return Math.round(Math.min(count / target, 1) * 100)
}
