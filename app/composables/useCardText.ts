import { pickCardDesc, pickCardName } from '~~/shared/card-text'
import type { CardDescFields, CardNameFields } from '~~/shared/card-text'

/**
 * Card names and texts in the card language (ADR 0015). Payloads carry the
 * English `name` / `desc` and the German `nameDe` / `descDe`; these pick the
 * one to show and fall back to English when a card has no German data.
 */
export function useCardText() {
  const { cardLocale } = useCardLocale()

  /** The name to show for `card`. */
  function cardName(card: CardNameFields): string {
    return pickCardName(card, cardLocale.value)
  }

  /** The card text to show for `card`. */
  function cardDesc(card: CardDescFields): string | null {
    return pickCardDesc(card, cardLocale.value)
  }

  /** The English name when it differs from the one shown (a subtitle in German card language), else null. */
  function englishName(card: CardNameFields): string | null {
    const shown = cardName(card)
    return shown === card.name ? null : card.name
  }

  /** Whether `card` has German card text. */
  function hasGermanText(card: CardDescFields): boolean {
    return Boolean(card.descDe)
  }

  return { cardLocale, cardName, cardDesc, englishName, hasGermanText }
}
