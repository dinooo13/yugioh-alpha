import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { CardFacetFilters, USelect, USelectMenu } from '#components'
import RuleFormatEditor from '~/components/formats/RuleFormatEditor.vue'
import { DEFAULT_MAX_COPIES, MAX_COPIES_RULE } from '~~/shared/rule-formats'
import type { RuleSet } from '~~/shared/rule-formats'
import { selectWithOption } from './fixtures/select-wrapper'
import { setTestLocale } from './fixtures/locale'

const state = vi.hoisted(() => ({
  facets: {
    types: ['Normal Monster', 'Spell Card'],
    attributes: ['DARK', 'LIGHT'],
    races: ['Spellcaster'],
    levels: [1, 7],
    sets: [{ id: 'metal-raiders', name: 'Metal Raiders' }],
    // Sets without a printing of an active card (ADR 0025).
    setsWithoutCards: [
      { id: 'duel-terminal-5', name: 'Duel Terminal 5' },
      { id: 'lost-art', name: 'The Lost Art Promotion' },
    ],
  },
  decks: { items: [{ id: 'deck-1', name: 'Test Deck' }] },
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/catalog/facets') {
      return { data: ref(state.facets), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/decks') {
      return { data: ref(state.decks), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

function stubFetch(handler: (url: string, options?: Record<string, unknown>) => Promise<unknown>) {
  const mock = vi.fn((url: string, options?: Record<string, unknown>) => (
    url.startsWith('/api/formats')
      ? handler(url, options)
      : Promise.resolve(null)
  ))
  vi.stubGlobal('$fetch', mock)
  return mock
}

function formatCalls(mock: ReturnType<typeof stubFetch>) {
  return mock.mock.calls.filter(([url]) => String(url).startsWith('/api/formats'))
}

function addRule(component: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  return component.find(`[aria-label="Regel hinzufügen: ${label}"]`).trigger('click')
}

afterEach(async () => {
  await setTestLocale('de')
  vi.unstubAllGlobals()
})

// mountSuspended never unmounts; a later locale switch would re-render every earlier mount (#104).
enableAutoUnmount(afterEach)

describe('rule format editor', () => {
  it('renders the rules of an existing format with German summaries', async () => {
    const rules: RuleSet = {
      rules: [
        { kind: 'deck_size', section: 'main', min: 40, max: 60 },
        { kind: 'copies', maxCopies: 3 },
        { kind: 'banlist', source: 'goat' },
        { kind: 'card_status', status: 'forbidden', cardIds: [55144522] },
        {
          kind: 'filter',
          match: 'not_matching',
          filter: { releasedBefore: '2005-07-01', region: 'tcg' },
          maxCopies: 0,
          label: 'Nur Karten bis Juni 2005',
        },
      ],
    }

    const component = await mountSuspended(RuleFormatEditor, {
      props: {
        initialValues: {
          id: 'own-1',
          name: 'Mein GOAT',
          description: 'Hausregeln',
          rules,
          cardNames: { 55144522: 'Pot of Greed' },
        },
      },
    })

    const text = component.text()
    expect(text).toContain('5 Regeln')
    expect(text).toContain('Main Deck: 40–60 Karten')
    expect(text).toContain('Höchstens 3 Kopien pro Karte')
    expect(text).toContain('Offizielle Banliste (GOAT)')
    expect(text).toContain('Verboten: Pot of Greed')
    expect(text).toContain('Nur Karten bis Juni 2005')

    expect(component.find<HTMLInputElement>('input[aria-label="Formatname"]').element.value).toBe('Mein GOAT')
  })

  it('renders the editor and its rule summaries in English', async () => {
    await setTestLocale('en')

    const component = await mountSuspended(RuleFormatEditor, {
      props: {
        initialValues: {
          id: 'own-1',
          name: 'My GOAT',
          description: null,
          rules: {
            rules: [
              { kind: 'deck_size', section: 'main', min: 40, max: 60 },
              { kind: 'copies', maxCopies: 1 },
              { kind: 'card_status', status: 'limited', cardIds: [55144522] },
              { kind: 'filter', match: 'matching', filter: { types: ['Spell Card'] }, maxCopies: 2 },
            ],
          },
          cardNames: { 55144522: 'Pot of Greed' },
        },
      },
    })
    const text = component.text()

    expect(text).toContain('4 rules')
    expect(text).toContain('Main Deck: 40–60 cards')
    expect(text).toContain('At most 1 copy per card')
    expect(text).toContain('Limited (1): Pot of Greed')
    expect(text).toContain('Cards with card type Spell Card: semi-limited (max. 2)')
    expect(text).toContain('Card filter')
    expect(text).toContain('Add rule')
    expect(text).toContain('Check a deck')
    expect(component.find('[aria-label="Add rule: Deck size"]').exists()).toBe(true)
    expect(component.find('input[aria-label="Format name"]').exists()).toBe(true)
    expect(text).not.toMatch(/Regel|Karten|Kopie|Deck prüfen|Speichern/)
  })

  it('adds and removes rules', async () => {
    const component = await mountSuspended(RuleFormatEditor)

    expect(component.text()).toContain('Noch keine Regeln')

    await addRule(component, 'Deckgröße')
    expect(component.text()).toContain('Main Deck: 40–60 Karten')

    await addRule(component, 'Banliste')
    expect(component.text()).toContain('Offizielle Banliste (TCG)')
    expect(component.text()).toContain('2 Regeln')

    await component.find('[aria-label="Regel 1 entfernen"]').trigger('click')
    expect(component.text()).not.toContain('Main Deck: 40–60 Karten')
    expect(component.text()).toContain('1 Regel')
  })

  it('sends a normalized payload when creating a format', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ id: 'new-1', name: 'Nur alte Karten' }))

    const component = await mountSuspended(RuleFormatEditor)

    await component.find('input[aria-label="Formatname"]').setValue('  Nur alte Karten  ')
    await addRule(component, 'Deckgröße')
    await addRule(component, 'Kartenfilter')

    // Leave the filter at its defaults except for a release cut-off.
    await component.find('input[aria-label="Erschienen nach"]').setValue('2006-01-01')

    const saveButton = component.findAll('button').find(button => button.text().includes('Format erstellen'))
    await saveButton!.trigger('click')
    await flushPromises()

    expect(formatCalls(fetchMock)).toEqual([[
      '/api/formats',
      {
        method: 'POST',
        body: {
          name: 'Nur alte Karten',
          description: null,
          rules: {
            rules: [
              { kind: 'deck_size', section: 'main', min: 40, max: 60 },
              {
                kind: 'filter',
                match: 'matching',
                filter: { releasedAfter: '2006-01-01', region: 'tcg' },
                maxCopies: 0,
              },
            ],
          },
        },
      },
    ]])

    expect(component.emitted('saved')).toEqual([[{ id: 'new-1', name: 'Nur alte Karten' }]])
  })

  it('PATCHes an existing format instead of creating a new one', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ id: 'own-1', name: 'Mein Format' }))

    const component = await mountSuspended(RuleFormatEditor, {
      props: {
        initialValues: {
          id: 'own-1',
          name: 'Mein Format',
          description: null,
          rules: { rules: [{ kind: 'copies', maxCopies: 2 }] },
        },
      },
    })

    const saveButton = component.findAll('button').find(button => button.text().includes('Speichern'))
    await saveButton!.trigger('click')
    await flushPromises()

    expect(formatCalls(fetchMock)).toEqual([[
      '/api/formats/own-1',
      {
        method: 'PATCH',
        body: {
          name: 'Mein Format',
          description: null,
          rules: { rules: [{ kind: 'copies', maxCopies: 2 }] },
        },
      },
    ]])
  })

  it('previews the unsaved rules against one of the user\'s decks', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({
      validation: {
        legal: false,
        issues: [{ severity: 'error', code: 'card_forbidden', cardId: 55144522, message: 'Pot of Greed ist in diesem Format verboten.' }],
        cards: {},
      },
    }))

    const component = await mountSuspended(RuleFormatEditor)
    await addRule(component, 'Banliste')

    const checkButton = () => component.findAll('button').find(button => button.text().includes('Deck prüfen'))
    // Without a selected deck there is nothing to check.
    expect(checkButton()!.attributes('disabled')).toBeDefined()

    // The deck select is a Nuxt UI component that teleports its listbox, so
    // drive its v-model directly instead of opening the popup.
    const deckSelect = selectWithOption(component.findAllComponents(USelect), 'deck-1')
    await deckSelect!.setValue('deck-1')
    await component.vm.$nextTick()

    await checkButton()!.trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(formatCalls(fetchMock)).toEqual([[
      '/api/formats/validate',
      { method: 'POST', body: { deckId: 'deck-1', rules: { rules: [{ kind: 'banlist', source: 'tcg' }] } } },
    ]])

    expect(component.text()).toContain('Nicht legal – 1 Problem')
    expect(component.text()).toContain('Pot of Greed ist in diesem Format verboten.')
  })

  it('bounds the copies input by the shared maximum (#95)', async () => {
    const component = await mountSuspended(RuleFormatEditor)
    await addRule(component, 'Kopien pro Karte')

    const input = component.find<HTMLInputElement>('input[aria-label="Kopien pro Karte"]')
    expect(input.attributes('max')).toBe(String(MAX_COPIES_RULE))
    expect(input.element.value).toBe(String(DEFAULT_MAX_COPIES))
  })

  it('filters type, attribute and race with the shared facet menus, without a level menu (#120)', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ id: 'new-1', name: 'Nur DARK' }))

    const component = await mountSuspended(RuleFormatEditor)
    await component.find('input[aria-label="Formatname"]').setValue('Nur DARK')
    await addRule(component, 'Kartenfilter')

    const facetFilters = component.findComponent(CardFacetFilters)
    expect(facetFilters.exists()).toBe(true)
    for (const label of ['Typ', 'Attribut', 'Monsterart']) {
      expect(component.find(`[aria-label="${label}"]`).exists(), label).toBe(true)
    }
    // Levels are a min/max range in a format filter.
    expect(component.find('[aria-label="Level"]').exists()).toBe(false)
    expect(component.find('input[aria-label="Stufe/Rang ab"]').exists()).toBe(true)

    facetFilters.vm.$emit('update:attribute', ['DARK'])
    await component.vm.$nextTick()

    const saveButton = component.findAll('button').find(button => button.text().includes('Format erstellen'))
    await saveButton!.trigger('click')
    await flushPromises()

    const body = formatCalls(fetchMock)[0]![1] as { body: { rules: RuleSet } }
    expect(body.body.rules.rules).toEqual([
      { kind: 'filter', match: 'matching', filter: { attributes: ['DARK'] }, maxCopies: 0 },
    ])
  })

  it('keeps the name of an empty set a rule names and offers it there, but no other empty set (ADR 0025)', async () => {
    const component = await mountSuspended(RuleFormatEditor, {
      props: {
        initialValues: {
          id: 'own-1',
          name: 'Duel Terminal',
          description: null,
          rules: { rules: [{ kind: 'filter', match: 'not_matching', filter: { setIds: ['duel-terminal-5'] }, maxCopies: 0 }] },
          cardNames: {},
        },
      },
    })

    expect(component.text()).toContain('Set Duel Terminal 5')
    expect(component.text()).not.toContain('duel-terminal-5')

    const setMenu = selectWithOption(component.findAllComponents(USelectMenu), 'metal-raiders')
    expect(setMenu).toBeDefined()
    const values = (setMenu!.props('items') as Array<{ value: string }>).map(item => item.value)
    expect(values).toEqual(['metal-raiders', 'duel-terminal-5'])
    expect(values).not.toContain('lost-art')
  })

  it('offers no empty set to a new rule (ADR 0025)', async () => {
    const component = await mountSuspended(RuleFormatEditor)
    await addRule(component, 'Kartenfilter')

    const setMenu = selectWithOption(component.findAllComponents(USelectMenu), 'metal-raiders')
    const values = (setMenu!.props('items') as Array<{ value: string }>).map(item => item.value)
    expect(values).toEqual(['metal-raiders'])
  })

  it('explains that a "?" ATK/DEF is inside no range once one is set (#140)', async () => {
    const component = await mountSuspended(RuleFormatEditor)
    await addRule(component, 'Kartenfilter')

    const hint = 'Karten mit „?“ als ATK oder DEF liegen in keinem ATK-/DEF-Bereich.'
    expect(component.text()).not.toContain(hint)

    await component.find('input[aria-label="ATK bis"]').setValue('1500')
    expect(component.text()).toContain(hint)

    await component.find('input[aria-label="ATK bis"]').setValue('')
    expect(component.text()).not.toContain(hint)
  })

  it('hides every editing control for a read-only built-in format', async () => {
    const component = await mountSuspended(RuleFormatEditor, {
      props: {
        readonly: true,
        initialValues: {
          id: 'goat',
          name: 'GOAT Format',
          description: null,
          rules: { rules: [{ kind: 'banlist', source: 'goat' }] },
          isBuiltin: true,
        },
      },
    })

    expect(component.text()).toContain('Offizielle Banliste (GOAT)')
    expect(component.find('[aria-label="Regel hinzufügen: Banliste"]').exists()).toBe(false)
    expect(component.find('[aria-label="Regel 1 entfernen"]').exists()).toBe(false)
    expect(component.findAll('button').some(button => button.text().includes('Speichern'))).toBe(false)
    expect(component.find<HTMLInputElement>('input[aria-label="Formatname"]').element.disabled).toBe(true)
  })

  it('disables the facet menus of a read-only filter rule', async () => {
    const component = await mountSuspended(RuleFormatEditor, {
      props: {
        readonly: true,
        initialValues: {
          id: 'goat',
          name: 'GOAT Format',
          description: null,
          rules: { rules: [{ kind: 'filter', match: 'matching', filter: { attributes: ['DARK'] }, maxCopies: 1 }] },
          isBuiltin: true,
        },
      },
    })

    expect(component.findComponent(CardFacetFilters).props('disabled')).toBe(true)
    for (const label of ['Typ', 'Attribut', 'Monsterart']) {
      expect(component.find(`[aria-label="${label}"]`).attributes('disabled'), label).toBeDefined()
    }
  })
})
