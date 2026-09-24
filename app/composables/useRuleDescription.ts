import type { CapReason, CardFilter, DescribeOptions, Rule } from '~~/shared/rule-formats'
import { describeCapReason, describeCardFilter, describeRule } from '~/utils/rule-description'
import type { RuleDescriptionI18n } from '~/utils/rule-description'

/**
 * The rule describer (`app/utils/rule-description.ts`) bound to the active
 * interface language (ADR 0014); card types, attributes and races in a filter
 * are labelled in the card language (ADR 0015).
 */
export function useRuleDescription() {
  const { t, d } = useI18n()
  const { cardValue } = useCardText()
  const i18n: RuleDescriptionI18n = {
    t: (key, named, plural) => (plural === undefined ? t(key, named ?? {}) : t(key, named ?? {}, plural)),
    d: (value, key) => d(value, key),
    cardValue,
  }

  return {
    describeRule: (rule: Rule, options?: DescribeOptions & { label?: string }) => describeRule(i18n, rule, options),
    describeCardFilter: (filter: CardFilter, options?: DescribeOptions) => describeCardFilter(i18n, filter, options),
    describeCapReason: (reason: CapReason, options?: DescribeOptions & { filterLabel?: (label: string) => string }) =>
      describeCapReason(i18n, reason, options),
  }
}
