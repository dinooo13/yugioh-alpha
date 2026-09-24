/**
 * An ATK/DEF value as printed on the card. YGOPRODeck stores a "?" stat as -1
 * (catalog_card.atk/def keep that raw value); null means the card has none
 * (a Link monster's DEF), shown as a dash.
 */
export function formatCardStat(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '–'
  }
  return value < 0 ? '?' : String(value)
}
