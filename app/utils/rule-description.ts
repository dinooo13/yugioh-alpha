// Human-readable one-liners for rule formats (ADR 0005) in the interface
// language (ADR 0014): what a rule does (format editor), what a card filter
// matches, and why a card's copy limit is lowered (deck editor tooltip).
// Pure functions that take the translation functions; `useRuleDescription()`
// binds them to the active locale.

import type { CapReason, CardFilter, DescribeOptions, Rule } from '~~/shared/rule-formats'

export interface RuleDescriptionI18n {
  t: (key: string, named?: Record<string, unknown>, plural?: number) => string
  /** Formats a calendar date with the `date` named format. */
  d: (value: Date, key: string) => string
}

/** `2005-07-01` → the date in the locale's `date` format; unparseable input is returned as it is. */
export function formatIsoDate(i18n: RuleDescriptionI18n, value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return value
  }
  // Local midnight, so the day never shifts with the viewer's time zone.
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? value : i18n.d(date, 'date')
}

function nameFor(options: DescribeOptions | undefined, id: number): string {
  return options?.cardNames?.[id] ?? options?.cardNames?.[String(id)] ?? `#${id}`
}

function rangeLabel(i18n: RuleDescriptionI18n, label: string, min?: number, max?: number): string | null {
  if (min !== undefined && max !== undefined) {
    return i18n.t('formats.rule.cardFilter.range', { label, min, max })
  }
  if (min !== undefined) {
    return i18n.t('formats.rule.cardFilter.rangeMin', { label, min })
  }
  if (max !== undefined) {
    return i18n.t('formats.rule.cardFilter.rangeMax', { label, max })
  }
  return null
}

function copiesLabel(i18n: RuleDescriptionI18n, maxCopies: number): string {
  if (maxCopies <= 0) {
    return i18n.t('formats.rule.filter.copies.forbidden')
  }
  if (maxCopies === 1) {
    return i18n.t('formats.rule.filter.copies.limited')
  }
  if (maxCopies === 2) {
    return i18n.t('formats.rule.filter.copies.semiLimited')
  }
  return i18n.t('formats.rule.filter.copies.allowed', { max: maxCopies })
}

/** A one-liner for a card filter, e.g. "Attribut DARK, Stufe ab 5". */
export function describeCardFilter(i18n: RuleDescriptionI18n, filter: CardFilter, options?: DescribeOptions): string {
  const { t } = i18n
  const parts: string[] = []
  const region = filter.region === 'ocg' ? 'OCG' : 'TCG'
  const either = (values: string[]) => values.join(` ${t('formats.rule.cardFilter.or')} `)

  if (filter.types?.length) {
    parts.push(t('formats.rule.cardFilter.types', { values: either(filter.types) }))
  }
  if (filter.frameTypes?.length) {
    parts.push(t('formats.rule.cardFilter.frameTypes', { values: either(filter.frameTypes) }))
  }
  if (filter.attributes?.length) {
    parts.push(t('formats.rule.cardFilter.attributes', { values: either(filter.attributes) }))
  }
  if (filter.races?.length) {
    parts.push(t('formats.rule.cardFilter.races', { values: either(filter.races) }))
  }
  if (filter.archetypes?.length) {
    parts.push(t('formats.rule.cardFilter.archetypes', { values: either(filter.archetypes) }))
  }
  if (filter.setIds?.length) {
    parts.push(t('formats.rule.cardFilter.sets', { values: either(filter.setIds.map(id => options?.setNames?.[id] ?? id)) }))
  }
  if (filter.cardIds?.length) {
    parts.push(t('formats.rule.cardFilter.cards', { values: filter.cardIds.map(id => nameFor(options, id)).join(', ') }))
  }

  const ranges = [
    rangeLabel(i18n, t('formats.rule.cardFilter.level'), filter.levelMin, filter.levelMax),
    rangeLabel(i18n, 'ATK', filter.atkMin, filter.atkMax),
    rangeLabel(i18n, 'DEF', filter.defMin, filter.defMax),
  ]
  for (const range of ranges) {
    if (range) {
      parts.push(range)
    }
  }

  if (filter.hasEffect !== undefined) {
    parts.push(t(filter.hasEffect ? 'formats.rule.cardFilter.withEffect' : 'formats.rule.cardFilter.withoutEffect'))
  }
  if (filter.releasedBefore !== undefined) {
    parts.push(t('formats.rule.cardFilter.releasedBefore', { date: formatIsoDate(i18n, filter.releasedBefore), region }))
  }
  if (filter.releasedAfter !== undefined) {
    parts.push(t('formats.rule.cardFilter.releasedAfter', { date: formatIsoDate(i18n, filter.releasedAfter), region }))
  }
  if (filter.nameContains) {
    parts.push(t('formats.rule.cardFilter.nameContains', { text: filter.nameContains }))
  }

  return parts.length > 0 ? parts.join(', ') : t('formats.rule.cardFilter.all')
}

/**
 * A one-liner describing what a rule does, for the format editor. A filter
 * rule's `label` is used as it is; pass `label` to override it (a built-in
 * format's translated label, see `useFormatLabel`).
 */
export function describeRule(i18n: RuleDescriptionI18n, rule: Rule, options?: DescribeOptions & { label?: string }): string {
  const { t } = i18n
  switch (rule.kind) {
    case 'deck_size': {
      const section = t(`decks.section.${rule.section}`)
      if (rule.min !== undefined && rule.max !== undefined) {
        return t('formats.rule.deckSize.range', { section, min: rule.min, max: rule.max }, rule.max)
      }
      if (rule.min !== undefined) {
        return t('formats.rule.deckSize.min', { section, min: rule.min }, rule.min)
      }
      if (rule.max !== undefined) {
        return t('formats.rule.deckSize.max', { section, max: rule.max }, rule.max)
      }
      return t('formats.rule.deckSize.none', { section })
    }
    case 'copies':
      return t('formats.rule.copies', { count: rule.maxCopies }, rule.maxCopies)
    case 'card_status': {
      const names = rule.cardIds.map(id => nameFor(options, id)).join(', ')
      return t('formats.rule.cardStatus', {
        status: t(`formats.cardStatus.${rule.status}`),
        cards: names || t('formats.rule.noCardsSelected'),
      })
    }
    case 'banlist':
      return t('formats.rule.banlist', { source: rule.source.toUpperCase() })
    case 'filter': {
      const params = { filter: describeCardFilter(i18n, rule.filter, options), copies: copiesLabel(i18n, rule.maxCopies) }
      const body = t(rule.match === 'matching' ? 'formats.rule.filter.matching' : 'formats.rule.filter.notMatching', params)
      const label = options?.label ?? rule.label
      return label ? t('formats.rule.filter.labelled', { label, rule: body }) : body
    }
  }
}

/**
 * Why a card's copy limit is lowered (the deck editor's status-badge
 * tooltip). `filterLabel` overrides a filter rule's own label (built-ins).
 */
export function describeCapReason(
  i18n: RuleDescriptionI18n,
  reason: CapReason,
  options?: DescribeOptions & { filterLabel?: (label: string) => string },
): string {
  switch (reason.kind) {
    case 'format_rule':
      return i18n.t(`formats.capReason.formatRule.${reason.status}`)
    case 'banlist':
      return i18n.t('formats.capReason.banlist', { source: reason.source.toUpperCase(), status: reason.raw })
    case 'filter': {
      const label = reason.label ?? reason.rule.label
      if (label) {
        return options?.filterLabel ? options.filterLabel(label) : label
      }
      return describeRule(i18n, reason.rule, options)
    }
  }
}
