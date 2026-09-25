import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CardFacetFilters from '~/components/card/CardFacetFilters.vue'
import { setTestLocale } from './fixtures/locale'

// The facet menus shared by the catalog and the inventory (#63).

const facets = { types: ['Normal Monster'], attributes: ['LIGHT'], races: ['Dragon'], levels: [8] }

function mountFilters() {
  return mountSuspended(CardFacetFilters, {
    props: {
      facets,
      type: ['Normal Monster'],
      attribute: ['LIGHT'],
      race: [],
      level: [8],
    },
  })
}

afterEach(async () => {
  useState('card-locale-choice').value = null
  await setTestLocale('de')
})

describe('CardFacetFilters', () => {
  it('renders the four menus with German labels and German card values', async () => {
    const component = await mountFilters()

    for (const label of ['Typ', 'Attribut', 'Monsterart', 'Stufe/Rang']) {
      expect(component.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
    expect(component.find('[aria-label="Typ"]').text()).toContain('Normales Monster')
    expect(component.find('[aria-label="Attribut"]').text()).toContain('LICHT')
    // Konami's filter label: the level menu also matches Xyz ranks (#101).
    expect(component.find('[aria-label="Stufe/Rang"]').text()).toContain('Stufe/Rang 8')
    // Nothing picked: the menu shows its placeholder.
    expect(component.find('[aria-label="Monsterart"]').text()).toContain('Monsterart')
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    const component = await mountFilters()

    for (const label of ['Type', 'Attribute', 'Monster type', 'Level/Rank']) {
      expect(component.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
    expect(component.find('[aria-label="Type"]').text()).toContain('Normal Monster')
    expect(component.find('[aria-label="Attribute"]').text()).toContain('LIGHT')
  })

  it('keeps German labels but shows English values when the cards are English (ADR 0015)', async () => {
    useState('card-locale-choice').value = 'en'
    const component = await mountFilters()

    expect(component.find('[aria-label="Typ"]').text()).toContain('Normal Monster')
    expect(component.find('[aria-label="Attribut"]').text()).toContain('LIGHT')
    expect(component.find('[aria-label="Attribut"]').text()).not.toContain('LICHT')
  })
})
