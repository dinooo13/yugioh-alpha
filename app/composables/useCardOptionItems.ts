import { CARD_CONDITIONS, CARD_EDITIONS, PRINTING_LANGUAGES } from '~~/shared/inventory'

/**
 * Select items and labels for the properties of an owned copy (ADR 0002) in
 * the interface language (ADR 0014): printing language, condition and
 * edition. The values come from `shared/inventory`, the labels from
 * `card.printingLanguage.<v>`, `card.condition.<v>` and `card.edition.<v>`
 * (long form, for selects) or `card.conditionShort.<v>` /
 * `card.editionShort.<v>` (badges and filters). An unknown value is shown
 * as it is.
 */
export function useCardOptionItems() {
  const { t, te } = useI18n()

  function label(prefix: string, value: string): string {
    const key = `${prefix}.${value}`
    return te(key) ? t(key) : value
  }

  const languageLabel = (value: string) => label('card.printingLanguage', value)
  const conditionLabel = (value: string) => label('card.condition', value)
  const editionLabel = (value: string) => label('card.edition', value)
  const conditionShortLabel = (value: string) => label('card.conditionShort', value)
  const editionShortLabel = (value: string) => label('card.editionShort', value)

  const languageItems = computed(() => PRINTING_LANGUAGES.map(value => ({ label: languageLabel(value), value: value as string })))
  const conditionItems = computed(() => CARD_CONDITIONS.map(value => ({ label: conditionLabel(value), value: value as string })))
  const editionItems = computed(() => CARD_EDITIONS.map(value => ({ label: editionLabel(value), value: value as string })))

  return {
    languageItems,
    conditionItems,
    editionItems,
    languageLabel,
    conditionLabel,
    editionLabel,
    conditionShortLabel,
    editionShortLabel,
  }
}
