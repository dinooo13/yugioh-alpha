// Previews a deck the chat assistant is *proposing* — a new deck
// (`create_deck`), a set of changes to an existing one (`update_deck_cards`),
// or either of those checked up front via `validate_deck` — without writing
// anything (docs/adr/0011-deck-assistance-in-chat.md).
//
// The preview carries exactly what the old one-shot deck assistant used to
// guarantee before its "Übernehmen" (ADR 0006): legality is the rule
// engine's verdict (`evaluateDeck` via `validateDeckCards`), never the
// model's claim, and cards the user doesn't own (enough of) are listed
// separately from the deck itself.

import type { useDb } from '../db'
import { DECK_SECTIONS } from '../../shared/deck-sections'
import type { DeckSection } from '../../shared/deck-sections'
import type { RuleSet } from '../../shared/rule-formats'
import type { AssistantDeckPreview } from '../../shared/assistant-chat'
import { getDeckDetail } from './decks'
import type { DeckCardInput } from './decks'
import { loadCardNames, validateDeckCards } from './deck-validation'
import { ownedQuantitiesByCard } from './inventory'
import { requireAccessibleFormat } from './rule-formats'

type Db = ReturnType<typeof useDb>

export interface DeckProposalInput {
  /** An existing deck of the caller's — its current cards are the starting point for `changes`. */
  deckId?: string
  /** A complete planned deck (a new deck); ignored when `deckId` is set. */
  cards?: DeckCardInput[]
  /** Absolute per-(card, section) quantities applied on top of `deckId`'s cards; 0 removes the row. */
  changes?: DeckCardInput[]
  /** Checks against this format instead of the deck's own (or no format at all for a new deck). */
  formatId?: string | null
}

function keyOf(catalogCardId: number, section: DeckSection): string {
  return `${catalogCardId}:${section}`
}

/**
 * Builds the resulting card list (deck + changes, or the planned cards) and
 * reports counts, legality, and missing cards for it. Throws the same 404s as
 * the rest of the server for a foreign/unknown deck or format.
 */
export function previewDeckProposal(db: Db, userId: string, input: DeckProposalInput): AssistantDeckPreview {
  const quantities = new Map<string, { catalogCardId: number, section: DeckSection, quantity: number }>()
  const names: Record<number, string> = {}
  let formatId: string | null = null

  if (input.deckId) {
    const detail = getDeckDetail(db, userId, input.deckId)
    formatId = detail.format?.id ?? null
    for (const section of DECK_SECTIONS) {
      for (const row of detail.sections[section]) {
        quantities.set(keyOf(row.catalogCardId, section), { catalogCardId: row.catalogCardId, section, quantity: row.quantity })
        names[row.catalogCardId] = row.name
      }
    }
    for (const change of input.changes ?? []) {
      quantities.set(keyOf(change.catalogCardId, change.section), { ...change })
    }
  }
  else {
    // Duplicate (card, section) entries in a planned deck add up, the same
    // way they would if the model listed a card twice.
    for (const card of input.cards ?? []) {
      const key = keyOf(card.catalogCardId, card.section)
      const existing = quantities.get(key)
      quantities.set(key, { ...card, quantity: (existing?.quantity ?? 0) + card.quantity })
    }
  }

  if (input.formatId) {
    formatId = input.formatId
  }

  const entries = [...quantities.values()].filter(entry => entry.quantity > 0)
  const cardIds = [...new Set(entries.map(entry => entry.catalogCardId))]
  Object.assign(names, loadCardNames(db, cardIds.filter(id => !(id in names))))

  const counts = { main: 0, extra: 0, side: 0, total: 0 }
  const neededByCard = new Map<number, number>()
  for (const entry of entries) {
    counts[entry.section] += entry.quantity
    counts.total += entry.quantity
    neededByCard.set(entry.catalogCardId, (neededByCard.get(entry.catalogCardId) ?? 0) + entry.quantity)
  }

  let formatName: string | null = null
  let rules: RuleSet | null = null
  if (formatId) {
    const format = requireAccessibleFormat(db, userId, formatId)
    formatName = format.name
    rules = format.rules ?? { rules: [] }
  }

  const validation = rules
    ? validateDeckCards(db, rules, entries, { cardNames: names })
    : null

  const owned = ownedQuantitiesByCard(db, userId, cardIds)
  const missing = [...neededByCard.entries()]
    .map(([catalogCardId, needed]) => ({
      catalogCardId,
      name: names[catalogCardId] ?? `#${catalogCardId}`,
      needed,
      owned: owned.get(catalogCardId) ?? 0,
    }))
    .filter(card => card.owned < card.needed)
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    formatId,
    formatName,
    counts,
    validation: validation
      ? { legal: validation.legal, issues: validation.issues.map(issue => issue.message) }
      : null,
    missing,
  }
}
