// The "type · level · attribute" line under a card name in deck rows, deck
// search results and shared lists (#78): type and attribute follow the card
// language (ADR 0015), the level / rank / link word follows the interface
// language (#101).
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
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

const DARK_EFFECT_MONSTER = { type: 'Effect Monster', level: 7, attribute: 'DARK' }

describe('useCardText().cardMetaLine', () => {
  it('joins type, level and attribute in German and leaves out missing parts', async () => {
    const { cardMetaLine } = await cardText()

    expect(cardMetaLine(DARK_EFFECT_MONSTER)).toBe('Effektmonster · Stufe 7 · FINSTERNIS')
    expect(cardMetaLine({ type: 'Spell Card', level: null, attribute: null })).toBe('Zauberkarte')
  })

  it('keeps a level of 0', async () => {
    const { cardMetaLine } = await cardText()

    expect(cardMetaLine({ type: 'Normal Monster', level: 0, attribute: 'LIGHT' })).toBe('Normales Monster · Stufe 0 · LICHT')
  })

  it('shows an Xyz monster\'s rank and a Link monster\'s rating, never "Stufe 0" (#101)', async () => {
    const { cardMetaLine } = await cardText()

    expect(cardMetaLine({ type: 'XYZ Monster', level: 4, attribute: 'LIGHT' })).toBe('Xyz-Monster · Rang 4 · LICHT')
    // List rows carry no `linkval`: the rating is left out, not "Stufe 0".
    expect(cardMetaLine({ type: 'Link Monster', level: 0, attribute: 'DARK' })).toBe('Linkmonster · FINSTERNIS')
    expect(cardMetaLine({ type: 'Link Monster', level: null, linkval: 3, attribute: 'DARK' })).toBe('Linkmonster · Link 3 · FINSTERNIS')
  })

  it('uses English words with an English interface and card language', async () => {
    await setTestLocale('en')
    const { cardMetaLine } = await cardText()

    expect(cardMetaLine(DARK_EFFECT_MONSTER)).toBe('Effect Monster · Level 7 · DARK')
    expect(cardMetaLine({ type: 'XYZ Monster', level: 4, attribute: 'LIGHT' })).toBe('XYZ Monster · Rank 4 · LIGHT')
  })

  it('takes the level word from the interface language and the values from the card language', async () => {
    await setTestLocale('en')
    useState(CARD_LOCALE_CHOICE_STATE).value = 'de'
    const { cardMetaLine } = await cardText()

    expect(cardMetaLine(DARK_EFFECT_MONSTER)).toBe('Effektmonster · Level 7 · FINSTERNIS')
  })

  it('shows a value without a label as it is stored', async () => {
    const { cardMetaLine } = await cardText()

    expect(cardMetaLine({ type: 'Unknown Card', level: null, attribute: null })).toBe('Unknown Card')
  })
})
