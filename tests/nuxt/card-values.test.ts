// Card data labels (ADR 0015, #34 F3d): card type, attribute and race are
// stored in English and shown in the card language through `card.value.*`;
// unknown values are shown as stored, filter values stay English.
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { cardValueKey } from '~/utils/card-values'
import { cardSubtitle } from '~/utils/inventory-search-result'
import { CARD_LOCALE_CHOICE_STATE } from '~/utils/ui-locale'
import { setTestLocale } from './fixtures/locale'

afterEach(async () => {
  useState(CARD_LOCALE_CHOICE_STATE).value = null
  await setTestLocale('de')
})

async function cardText() {
  let api!: ReturnType<typeof useCardText>
  await mountSuspended(defineComponent({
    setup() {
      api = useCardText()
      return () => h('div')
    },
  }))
  return api
}

describe('cardValueKey', () => {
  it('lowercases the stored value and replaces everything but letters and digits with _', () => {
    expect(cardValueKey('attribute', 'DARK')).toBe('card.value.attribute.dark')
    expect(cardValueKey('race', 'Beast-Warrior')).toBe('card.value.race.beast_warrior')
    expect(cardValueKey('race', 'Quick-Play')).toBe('card.value.race.quick_play')
    expect(cardValueKey('type', 'XYZ Pendulum Effect Monster')).toBe('card.value.type.xyz_pendulum_effect_monster')
  })
})

describe('useCardText().cardValue', () => {
  it('labels types, attributes, races and Spell/Trap subtypes with the official German words', async () => {
    const { cardValue } = await cardText()

    expect(cardValue('attribute', 'DARK')).toBe('FINSTERNIS')
    expect(cardValue('attribute', 'DIVINE')).toBe('GÖTTLICH')
    expect(cardValue('race', 'Spellcaster')).toBe('Hexer')
    expect(cardValue('race', 'Fiend')).toBe('Unterweltler')
    expect(cardValue('race', 'Winged Beast')).toBe('Geflügeltes Ungeheuer')
    expect(cardValue('race', 'Quick-Play')).toBe('Schnell')
    expect(cardValue('race', 'Continuous')).toBe('Permanent')
    expect(cardValue('race', 'Counter')).toBe('Konter')
    expect(cardValue('type', 'Tuner Monster')).toBe('Empfänger-Monster')
    expect(cardValue('type', 'Normal Monster')).toBe('Normales Monster')
    expect(cardValue('type', 'Spell Card')).toBe('Zauberkarte')
    expect(cardValue('type', 'XYZ Monster')).toBe('Xyz-Monster')
    // Konami EU's Speed Duel wording, and a literal translation for the
    // OCG-only Creator God (#102).
    expect(cardValue('type', 'Skill Card')).toBe('Skill-Karte')
    expect(cardValue('race', 'Creator God')).toBe('Schöpfergott')
  })

  it('shows unknown values as they are stored and matches values in any case', async () => {
    const { cardValue } = await cardText()

    // A Skill card's "race" is a character name.
    expect(cardValue('race', 'Yami Yugi')).toBe('Yami Yugi')
    // Rule format filters compare ignoring case.
    expect(cardValue('attribute', 'dark')).toBe('FINSTERNIS')
  })

  it('shows the stored English values in English card language', async () => {
    const { cardValue } = await cardText()
    await setTestLocale('en')

    expect(cardValue('attribute', 'DARK')).toBe('DARK')
    expect(cardValue('race', 'Spellcaster')).toBe('Spellcaster')
    expect(cardValue('type', 'Effect Monster')).toBe('Effect Monster')
  })

  it('follows the card language, not the interface language', async () => {
    const { cardValue } = await cardText()

    // German interface, English cards.
    useState(CARD_LOCALE_CHOICE_STATE).value = 'en'
    expect(cardValue('attribute', 'DARK')).toBe('DARK')

    // English interface, German cards: the German catalogue is loaded as the fallback locale.
    await setTestLocale('en')
    useState(CARD_LOCALE_CHOICE_STATE).value = 'de'
    expect(cardValue('attribute', 'DARK')).toBe('FINSTERNIS')
    expect(cardValue('race', 'Spellcaster')).toBe('Hexer')
  })
})

describe('useCardText().cardValueOptions', () => {
  it('keeps the English values, labels them in the card language and sorts by label', async () => {
    const { cardValueOptions } = await cardText()

    expect(cardValueOptions('attribute', ['DARK', 'EARTH', 'LIGHT'])).toEqual([
      { label: 'ERDE', value: 'EARTH' },
      { label: 'FINSTERNIS', value: 'DARK' },
      { label: 'LICHT', value: 'LIGHT' },
    ])

    await setTestLocale('en')
    expect(cardValueOptions('attribute', ['LIGHT', 'DARK'])).toEqual([
      { label: 'DARK', value: 'DARK' },
      { label: 'LIGHT', value: 'LIGHT' },
    ])
  })
})

describe('cardSubtitle', () => {
  it('joins type, attribute and race, labelled by the given function', async () => {
    const { cardValue } = await cardText()
    const item = { type: 'Normal Monster', attribute: 'DARK', race: 'Spellcaster' }

    expect(cardSubtitle(item)).toBe('Normal Monster · DARK · Spellcaster')
    expect(cardSubtitle(item, cardValue)).toBe('Normales Monster · FINSTERNIS · Hexer')
    expect(cardSubtitle({ type: 'Spell Card', attribute: null, race: 'Quick-Play' }, cardValue)).toBe('Zauberkarte · Schnell')
  })
})
