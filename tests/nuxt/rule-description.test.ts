import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { ValidationIssue } from '~~/shared/rule-formats'
import { copyName } from '~/utils/copy-name'
import { setTestLocale } from './fixtures/locale'

afterEach(() => setTestLocale('de'))

// The composables need a component instance (useI18n); the functions they
// return follow later locale switches.
async function composables() {
  let api!: ReturnType<typeof useRuleDescription> & ReturnType<typeof useFormatLabel> & {
    validationText: ReturnType<typeof useValidationText>
  }
  await mountSuspended(defineComponent({
    setup() {
      api = { ...useRuleDescription(), ...useFormatLabel(), validationText: useValidationText() }
      return () => h('div')
    },
  }))
  return api
}

const POT_OF_GREED = 55144522

describe('rule describer', () => {
  it('describes every rule kind in German', async () => {
    const { describeRule } = await composables()

    expect(describeRule({ kind: 'deck_size', section: 'main', min: 40, max: 60 })).toBe('Main Deck: 40–60 Karten')
    expect(describeRule({ kind: 'deck_size', section: 'extra', max: 15 })).toBe('Extra Deck: höchstens 15 Karten')
    expect(describeRule({ kind: 'deck_size', section: 'side', min: 1 })).toBe('Side Deck: mindestens 1 Karte')
    expect(describeRule({ kind: 'copies', maxCopies: 3 })).toBe('Höchstens 3 Kopien pro Karte')
    expect(describeRule({ kind: 'copies', maxCopies: 1 })).toBe('Höchstens 1 Kopie pro Karte')
    expect(describeRule({ kind: 'banlist', source: 'goat' })).toBe('Offizielle Banliste (GOAT)')
    expect(describeRule({ kind: 'banlist', source: 'classic-plus' })).toBe('Banliste (Classic Plus)')
    expect(describeRule(
      { kind: 'card_status', status: 'forbidden', cardIds: [POT_OF_GREED] },
      { cardNames: { [POT_OF_GREED]: 'Pot of Greed' } },
    )).toBe('Verboten: Pot of Greed')
    expect(describeRule({ kind: 'card_status', status: 'limited', cardIds: [] })).toBe('Limitiert (1): keine Karten ausgewählt')
    expect(describeRule({ kind: 'filter', match: 'matching', filter: { releasedAfter: '2005-07-01' }, maxCopies: 0 }))
      .toBe('Karten mit erschienen nach dem 01.07.2005 (TCG): verboten')
    expect(describeRule({
      kind: 'filter',
      match: 'not_matching',
      filter: { releasedBefore: '2005-07-01', region: 'tcg' },
      maxCopies: 0,
      label: 'Nur Karten bis Juni 2005',
    })).toBe('Nur Karten bis Juni 2005 — Karten ohne erschienen vor dem 01.07.2005 (TCG): verboten')
    expect(describeRule({
      kind: 'filter',
      match: 'matching',
      filter: { attributes: ['DARK', 'LIGHT'], levelMin: 5, atkMax: 2000, hasEffect: false, nameContains: 'Dragon' },
      maxCopies: 2,
    })).toBe('Karten mit Attribut FINSTERNIS oder LICHT, Stufe/Rang ab 5, ATK bis 2000, ohne Effekt, Name enthält "Dragon": semi-limitiert (max. 2)')
    expect(describeRule({ kind: 'filter', match: 'matching', filter: {}, maxCopies: 3 })).toBe('Karten mit alle Karten: erlaubt (max. 3)')
  })

  it('labels card types, attributes and races in the card language (ADR 0015)', async () => {
    const { describeCardFilter } = await composables()
    const filter = { types: ['Spell Card'], attributes: ['dark'], races: ['Spellcaster', 'Yami Yugi'] }

    // German interface, German cards; stored in any case, unknown values as they are.
    expect(describeCardFilter(filter)).toBe('Typ Zauberkarte, Attribut FINSTERNIS, Art Hexer oder Yami Yugi')

    // German interface, English cards.
    useState('card-locale-choice').value = 'en'
    expect(describeCardFilter(filter)).toBe('Typ Spell Card, Attribut dark, Art Spellcaster oder Yami Yugi')

    // English interface, German cards.
    await setTestLocale('en')
    useState('card-locale-choice').value = 'de'
    expect(describeCardFilter(filter)).toBe('card type Zauberkarte, attribute FINSTERNIS, monster type Hexer or Yami Yugi')
    useState('card-locale-choice').value = null
  })

  it('describes every rule kind in English', async () => {
    const { describeRule } = await composables()
    await setTestLocale('en')

    expect(describeRule({ kind: 'deck_size', section: 'main', min: 40, max: 60 })).toBe('Main Deck: 40–60 cards')
    expect(describeRule({ kind: 'deck_size', section: 'extra', max: 15 })).toBe('Extra Deck: at most 15 cards')
    expect(describeRule({ kind: 'deck_size', section: 'side', min: 1 })).toBe('Side Deck: at least 1 card')
    expect(describeRule({ kind: 'copies', maxCopies: 3 })).toBe('At most 3 copies per card')
    expect(describeRule({ kind: 'banlist', source: 'tcg' })).toBe('Official banlist (TCG)')
    expect(describeRule({ kind: 'banlist', source: 'classic-plus' })).toBe('Banlist (Classic Plus)')
    expect(describeRule(
      { kind: 'card_status', status: 'semi_limited', cardIds: [POT_OF_GREED] },
      { cardNames: { [POT_OF_GREED]: 'Pot of Greed' } },
    )).toBe('Semi-limited (2): Pot of Greed')
    expect(describeRule({ kind: 'filter', match: 'not_matching', filter: { releasedBefore: '2005-07-01', region: 'ocg' }, maxCopies: 0 }))
      .toBe('Cards without released before 07/01/2005 (OCG): forbidden')
    expect(describeRule({
      kind: 'filter',
      match: 'matching',
      filter: { types: ['Spell Card', 'Trap Card'], setIds: ['lob'], cardIds: [POT_OF_GREED] },
      maxCopies: 1,
    }, { cardNames: { [POT_OF_GREED]: 'Pot of Greed' }, setNames: { lob: 'Legend of Blue Eyes' } }))
      .toBe('Cards with card type Spell Card or Trap Card, set Legend of Blue Eyes, card Pot of Greed: limited (max. 1)')
  })

  it('explains a lowered copy limit in the interface language', async () => {
    const { describeCapReason } = await composables()
    const cutoff = {
      kind: 'filter' as const,
      match: 'not_matching' as const,
      filter: { releasedBefore: '2005-07-01' },
      maxCopies: 0 as const,
      label: 'Only cards up to June 2005',
    }

    expect(describeCapReason({ kind: 'banlist', source: 'tcg', raw: 'Forbidden' })).toBe('TCG-Banliste: Forbidden')
    expect(describeCapReason({ kind: 'format_rule', status: 'limited' })).toBe('Formatregel: limitiert (1)')
    expect(describeCapReason({ kind: 'filter', label: cutoff.label, rule: cutoff }, { filterLabel: () => 'Nur Karten bis Juni 2005' }))
      .toBe('Nur Karten bis Juni 2005')
    expect(describeCapReason({ kind: 'filter', rule: { ...cutoff, label: undefined } }))
      .toBe('Karten ohne erschienen vor dem 01.07.2005 (TCG): verboten')

    await setTestLocale('en')
    expect(describeCapReason({ kind: 'banlist', source: 'goat', raw: 'Limited' })).toBe('GOAT banlist: Limited')
    expect(describeCapReason({ kind: 'banlist', source: 'classic-plus', raw: 'Limited' })).toBe('Classic Plus banlist: Limited')
    expect(describeCapReason({ kind: 'format_rule', status: 'forbidden' })).toBe('Format rule: forbidden')
  })
})

describe('validation issue text', () => {
  const issues: ValidationIssue[] = [
    { severity: 'error', code: 'deck_size_min', section: 'main', params: { section: 'main', count: 1, min: 40 }, message: 'The Main Deck has 1 card; at least 40 are required.' },
    { severity: 'error', code: 'deck_size_max', section: 'extra', params: { section: 'extra', count: 16, max: 15 }, message: 'x' },
    { severity: 'error', code: 'card_forbidden', cardId: POT_OF_GREED, params: { cardId: POT_OF_GREED, cardName: 'Pot of Greed' }, message: 'x' },
    { severity: 'error', code: 'card_limit_exceeded', cardId: 1, params: { cardId: 1, cardName: 'Raigeki', copies: 2, maxCopies: 1 }, message: 'x' },
    { severity: 'error', code: 'card_limit_exceeded', cardId: 2, params: { cardId: 2, cardName: 'Kuriboh', copies: 4, maxCopies: 3 }, message: 'x' },
    { severity: 'error', code: 'unknown_card_data', cardId: 123, params: { cardId: 123 }, message: 'x' },
  ]

  it('renders issues from code and params in German', async () => {
    const { validationText } = await composables()

    expect(issues.map(validationText)).toEqual([
      'Das Main Deck hat 1 Karte, mindestens 40 sind erforderlich.',
      'Das Extra Deck hat 16 Karten, höchstens 15 sind erlaubt.',
      'Pot of Greed ist in diesem Format verboten.',
      'Raigeki: 2 Kopien im Deck, erlaubt ist 1 Kopie.',
      'Kuriboh: 4 Kopien im Deck, erlaubt sind 3 Kopien.',
      'Zu einer Karte im Deck (ID 123) fehlen die Kartendaten.',
    ])
    expect(validationText({ code: 'main_below_min', params: { section: 'main', count: 0, min: 40 }, message: 'x' }))
      .toBe('Das Main Deck hat 0 Karten, mindestens 40 sind üblich.')
    expect(validationText({ code: 'copies_above_max', params: { cardName: 'Kuriboh', copies: 4, maxCopies: 3 }, message: 'x' }))
      .toBe('Kuriboh: 4 Kopien im Deck, höchstens 3 sind üblich.')
  })

  it('renders issues in English', async () => {
    const { validationText } = await composables()
    await setTestLocale('en')

    expect(issues.map(validationText)).toEqual([
      'The Main Deck has 1 card; at least 40 are required.',
      'The Extra Deck has 16 cards; at most 15 are allowed.',
      'Pot of Greed is forbidden in this format.',
      'Raigeki: 2 copies in the deck; 1 copy is allowed.',
      'Kuriboh: 4 copies in the deck; 3 copies are allowed.',
      'Card data is missing for a card in the deck (ID 123).',
    ])
    expect(validationText({ code: 'side_above_max', params: { section: 'side', count: 16, max: 15 }, message: 'x' }))
      .toBe('The Side Deck has 16 cards; the usual maximum is 15.')
  })

  it('falls back to the stored text for issues without params and plain strings', async () => {
    const { validationText } = await composables()

    expect(validationText({ code: 'card_forbidden', message: 'Pot of Greed ist in diesem Format verboten.' }))
      .toBe('Pot of Greed ist in diesem Format verboten.')
    expect(validationText({ code: 'something_new', params: {}, message: 'Stored text' })).toBe('Stored text')
    expect(validationText('Das Main Deck hat 3 Karten, mindestens 40 sind erforderlich.'))
      .toBe('Das Main Deck hat 3 Karten, mindestens 40 sind erforderlich.')
  })
})

describe('format labels', () => {
  it('translates built-in formats by id and leaves user formats alone', async () => {
    const { formatName, formatDescription, ruleLabel, sortFormats } = await composables()
    const builtins = [
      { id: 'tcg-advanced', name: 'TCG Advanced', description: 'English', isBuiltin: true },
      { id: 'unlimited', name: 'No banlist', description: 'English', isBuiltin: true },
      { id: 'goat', name: 'GOAT Format', description: 'English', isBuiltin: true },
      { id: 'ocg', name: 'OCG', description: 'English', isBuiltin: true },
    ]
    const own = { id: '0b8f…', name: 'Hausregeln', description: 'Meine Regeln', isBuiltin: false }

    expect(formatName(builtins[1]!)).toBe('Ohne Banliste')
    expect(formatDescription(builtins[1]!)).toContain('keinerlei Verbots- oder Beschränkungsliste')
    expect(formatName(own)).toBe('Hausregeln')
    expect(formatDescription(own)).toBe('Meine Regeln')
    // A format flagged as user-owned is never translated, even with a built-in id.
    expect(formatName({ id: 'goat', name: 'My GOAT', isBuiltin: false })).toBe('My GOAT')
    expect(ruleLabel({ id: 'goat' }, 'Only cards up to June 2005')).toBe('Nur Karten bis Juni 2005')
    expect(ruleLabel(own, 'Nur Zauber')).toBe('Nur Zauber')
    // Built-ins first, by their German name (as before the names moved to English).
    expect(sortFormats([own, ...builtins]).map(format => format.id)).toEqual(['goat', 'ocg', 'unlimited', 'tcg-advanced', own.id])

    await setTestLocale('en')
    expect(formatName(builtins[1]!)).toBe('No banlist')
    expect(ruleLabel({ id: 'goat' }, 'Only cards up to June 2005')).toBe('Only cards up to June 2005')
    expect(sortFormats([own, ...builtins]).map(format => format.id)).toEqual(['goat', 'unlimited', 'ocg', 'tcg-advanced', own.id])
  })

  it('names a copy without cutting off the suffix', () => {
    const render = (name: string) => `${name} (Kopie)`
    expect(copyName(render, 'Kurz', 80)).toBe('Kurz (Kopie)')
    const long = copyName(render, 'x'.repeat(80), 80)
    expect(long).toHaveLength(80)
    expect(long.endsWith(' (Kopie)')).toBe(true)
  })
})
