import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { USelect } from '#components'
import RuleFormatEditor from '~/components/formats/RuleFormatEditor.vue'
import type { RuleSet } from '~~/shared/rule-formats'
import { selectWithOption } from './fixtures/select-wrapper'

const state = vi.hoisted(() => ({
  facets: {
    types: ['Normal Monster', 'Spell Card'],
    attributes: ['DARK', 'LIGHT'],
    races: ['Spellcaster'],
    levels: [1, 7],
    sets: [{ id: 'metal-raiders', name: 'Metal Raiders' }],
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

afterEach(() => {
  vi.unstubAllGlobals()
})

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
})
