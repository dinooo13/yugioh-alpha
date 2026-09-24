// Bridges the pure rule engine (shared/rule-formats.ts) and the database:
// loads exactly the catalog fields a rule can look at and runs the engine.
//
// Validation results are never stored — they are recomputed on every read, so
// a banlist/catalog refresh or a format edit takes effect immediately
// (docs/adr/0005-rule-format-model.md).

import { inArray } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard, catalogPrinting } from '../db/schema'
import { defaultSectionForCard } from '../../shared/deck-sections'
import { DEFAULT_MAX_COPIES, evaluateDeck } from '../../shared/rule-formats'
import type {
  DeckCardEntry,
  DeckValidation,
  RuleSet,
  ValidationCardData,
} from '../../shared/rule-formats'

type Db = ReturnType<typeof useDb>

/**
 * Loads the catalog data the rule engine needs for `cardIds`: card fields plus
 * the ids of the sets the card has a printing in (one extra query, not one per
 * card).
 */
export function loadCardDataForValidation(db: Db, cardIds: number[]): Map<number, ValidationCardData> {
  const uniqueIds = [...new Set(cardIds)]
  const byId = new Map<number, ValidationCardData>()
  if (uniqueIds.length === 0) {
    return byId
  }

  const rows = db
    .select({
      id: catalogCard.id,
      name: catalogCard.name,
      type: catalogCard.type,
      frameType: catalogCard.frameType,
      attribute: catalogCard.attribute,
      race: catalogCard.race,
      archetype: catalogCard.archetype,
      level: catalogCard.level,
      atk: catalogCard.atk,
      def: catalogCard.def,
      banlistInfo: catalogCard.banlistInfo,
      tcgDate: catalogCard.tcgDate,
      ocgDate: catalogCard.ocgDate,
    })
    .from(catalogCard)
    .where(inArray(catalogCard.id, uniqueIds))
    .all()

  for (const row of rows) {
    byId.set(row.id, { ...row, setIds: [] })
  }

  const printings = db
    .select({ cardId: catalogPrinting.cardId, setId: catalogPrinting.setId })
    .from(catalogPrinting)
    .where(inArray(catalogPrinting.cardId, uniqueIds))
    .all()

  for (const printing of printings) {
    const card = byId.get(printing.cardId)
    if (card && !card.setIds!.includes(printing.setId)) {
      card.setIds!.push(printing.setId)
    }
  }

  return byId
}

/** Catalog card names by id — used for rule summaries in the format editor. */
export function loadCardNames(db: Db, cardIds: number[]): Record<number, string> {
  const uniqueIds = [...new Set(cardIds)]
  if (uniqueIds.length === 0) {
    return {}
  }

  const rows = db
    .select({ id: catalogCard.id, name: catalogCard.name })
    .from(catalogCard)
    .where(inArray(catalogCard.id, uniqueIds))
    .all()

  return Object.fromEntries(rows.map(row => [row.id, row.name]))
}

/** Card ids that do not exist in the catalog. */
export function missingCatalogCardIds(db: Db, cardIds: number[]): number[] {
  const uniqueIds = [...new Set(cardIds)]
  if (uniqueIds.length === 0) {
    return []
  }

  const known = new Set(db
    .select({ id: catalogCard.id })
    .from(catalogCard)
    .where(inArray(catalogCard.id, uniqueIds))
    .all()
    .map(row => row.id))

  return uniqueIds.filter(id => !known.has(id))
}

/** Runs the rule engine for one deck, loading the card data it needs. */
export function validateDeckCards(
  db: Db,
  ruleSet: RuleSet,
  deckCards: DeckCardEntry[],
): DeckValidation {
  const cardData = loadCardDataForValidation(db, deckCards.map(entry => entry.catalogCardId))
  return evaluateDeck(ruleSet, deckCards, cardData)
}

/**
 * The effective per-card copy limit under a rule set — the rule engine's own
 * `maxCopies` (the minimum of the `copies` rule, any `card_status`, the
 * banlist, and every applicable `filter` rule), so it can never disagree
 * with what `evaluateDeck` later reports. `0` means the card is forbidden.
 * Without a rule set every card gets the standard limit (3). Used by the chat
 * assistant's `search_inventory` to tell the model how many copies of an
 * owned card a format allows (docs/adr/0011-deck-assistance-in-chat.md).
 */
export function maxCopiesByCard(db: Db, rules: RuleSet | null, cardIds: number[]): Map<number, number> {
  const uniqueIds = [...new Set(cardIds)]
  if (!rules) {
    return new Map(uniqueIds.map(id => [id, DEFAULT_MAX_COPIES]))
  }

  const cardData = loadCardDataForValidation(db, uniqueIds)
  const cards = [...cardData.values()]
  const validation = evaluateDeck(
    rules,
    cards.map(card => ({ catalogCardId: card.id, section: defaultSectionForCard(card), quantity: 1 })),
    cardData,
  )

  return new Map(uniqueIds.map(id => [id, validation.cards[id]?.maxCopies ?? DEFAULT_MAX_COPIES]))
}
