import { pickCardDesc, pickCardName } from '~~/shared/card-text'
import type { CardDescFields, CardNameFields } from '~~/shared/card-text'
import { cardValueKey } from '~/utils/card-values'
import type { CardValueKind } from '~/utils/card-values'

/**
 * Card names, texts and data labels in the card language (ADR 0015).
 * Payloads carry the English `name` / `desc` and the German `nameDe` /
 * `descDe`; these pick the one to show and fall back to English when a card
 * has no German data. Card type, attribute and race are stored in English
 * and labelled through `card.value.*` (`app/utils/card-values.ts`).
 */
export function useCardText() {
  const { t, te } = useI18n()
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

  /**
   * The label of a stored type / attribute / race value in the card language
   * ("DARK" → "FINSTERNIS" in German); a value without a label is shown as
   * it is stored.
   *
   * The card language may differ from the interface language. Its messages
   * are there anyway: German is the fallback locale, so @nuxtjs/i18n loads
   * the German catalogue alongside the English one; and the English labels
   * are the stored values, so when English isn't loaded, the raw value is
   * already the right label.
   */
  function cardValue(kind: CardValueKind, value: string): string {
    const key = cardValueKey(kind, value)
    const locale = cardLocale.value
    return te(key, locale) ? t(key, {}, { locale }) : value
  }

  /** Filter options for stored values: the value stays English, the label follows the card language; sorted by label. */
  function cardValueOptions(kind: CardValueKind, values: readonly string[]): Array<{ label: string, value: string }> {
    return values
      .map(value => ({ label: cardValue(kind, value), value }))
      .sort((a, b) => a.label.localeCompare(b.label, cardLocale.value))
  }

  return { cardLocale, cardName, cardDesc, englishName, hasGermanText, cardValue, cardValueOptions }
}
