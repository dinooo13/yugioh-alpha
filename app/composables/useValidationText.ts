import type { ValidationIssueParams } from '~~/shared/rule-formats'

/** A deck validation issue or structural deck warning (`shared/rule-formats`). */
export interface ValidationTextSource {
  code: string
  message: string
  /** Missing on issues stored before #34 F2c. */
  params?: ValidationIssueParams
}

/**
 * Renders deck validation issues and deck warnings in the interface language
 * (ADR 0014) and their card names in the card language (ADR 0015):
 * `validation.<code>` with the issue's `params`, the section as
 * `decks.section.<section>`. The server's `message` is canonical English for
 * the assistant model; it is only shown for issues without `params` (stored
 * before #34 F2c) or with an unknown code. A plain string (an old stored
 * preview, e.g. an assistant ActionCard's `issues`) is returned as it is.
 */
export function useValidationText() {
  const { t, te, n } = useI18n()
  const { cardName } = useCardText()

  return (issue: ValidationTextSource | string): string => {
    if (typeof issue === 'string') {
      return issue
    }
    const key = `validation.${issue.code}`
    if (!issue.params || !te(key)) {
      return issue.message
    }

    const { section, count, cardNameDe, ...rest } = issue.params
    const named: Record<string, unknown> = { ...rest }
    // The card in the card language (ADR 0015); `cardNameDe` is missing on
    // issues stored before #34 F3c and for cards without a German name.
    if (rest.cardName !== undefined) {
      named.cardName = cardName({ name: rest.cardName, nameDe: cardNameDe })
    }
    if (section) {
      named.section = t(`decks.section.${section}`)
    }
    if (count !== undefined) {
      named.count = n(count, 'integer')
    }
    // The plural form follows the card count, or the allowed copies for the
    // per-card messages ("erlaubt ist 1 Kopie").
    return t(key, named, count ?? issue.params.maxCopies ?? 1)
  }
}
