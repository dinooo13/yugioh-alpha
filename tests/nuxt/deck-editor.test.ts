import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { USelect } from '#components'
import DeckEditorPage from '~/pages/decks/[id].vue'
import { optionLabels, selectWithOption } from './fixtures/select-wrapper'
import type { DeckValidation } from '~~/shared/rule-formats'

type DeckSection = 'main' | 'extra' | 'side'

interface DeckCardRow {
  catalogCardId: number
  name: string
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  section: DeckSection
  quantity: number
  owned: number
  usedInDeck: number
  shortfall: number
}

function row(overrides: Partial<DeckCardRow> & { name: string, section: DeckSection }): DeckCardRow {
  return {
    catalogCardId: 46986414,
    type: 'Normal Monster',
    frameType: 'normal',
    attribute: 'DARK',
    race: 'Spellcaster',
    level: 7,
    atk: 2500,
    def: 2100,
    imageSmall: null,
    quantity: 1,
    owned: 1,
    usedInDeck: 1,
    shortfall: 0,
    ...overrides,
  }
}

const state = vi.hoisted(() => ({
  deck: {} as Record<string, unknown>,
  source: { items: [] as Array<Record<string, unknown>>, total: 0 },
  facets: { types: [] as string[], attributes: [] as string[] },
  ownedQuantities: {} as Record<string, number>,
  formats: {
    items: [
      { id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true },
      { id: 'own-1', name: 'Nur alte Karten', isBuiltin: false },
    ],
  },
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url

    if (resolvedUrl === '/api/inventory/search' || resolvedUrl === '/api/catalog/cards') {
      return { data: ref(state.source), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/inventory/search/facets') {
      return { data: ref(state.facets), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/inventory/owned-quantities') {
      return { data: ref(state.ownedQuantities), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/formats') {
      return { data: ref(state.formats), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(state.deck), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/decks/deck-1', params: { id: 'deck-1' }, query: {} })
})

function deckDetail(
  sections: Partial<Record<DeckSection, DeckCardRow[]>>,
  warnings: Array<{ code: string, message: string }> = [],
  format: { id: string, name: string, isBuiltin: boolean } | null = null,
  validation: DeckValidation | null = null,
) {
  const full = { main: [], extra: [], side: [], ...sections } as Record<DeckSection, DeckCardRow[]>
  const count = (section: DeckSection) => full[section].reduce((total, card) => total + card.quantity, 0)

  return {
    format,
    validation,
    id: 'deck-1',
    name: 'Test Deck',
    description: 'Meine Notizen',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    sections: full,
    counts: {
      main: count('main'),
      extra: count('extra'),
      side: count('side'),
      total: count('main') + count('extra') + count('side'),
    },
    limits: { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15, maxCopies: 3 },
    warnings,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  state.ownedQuantities = {}
})

describe('deck editor', () => {
  it('renders the deck header, section counts against their limits, and warnings', async () => {
    state.source = { items: [], total: 0 }
    state.facets = { types: [], attributes: [] }
    state.deck = deckDetail(
      {
        main: [row({ name: 'Dark Magician', section: 'main', quantity: 3, owned: 2, usedInDeck: 3, shortfall: 1 })],
        extra: [row({
          name: 'Stardust Dragon',
          section: 'extra',
          catalogCardId: 44508094,
          type: 'Synchro Monster',
          frameType: 'synchro',
          level: 8,
        })],
      },
      [{ code: 'main_below_min', message: 'Das Main Deck hat 3 Karten, mindestens 40 sind üblich.' }],
    )

    const component = await mountSuspended(DeckEditorPage)
    const text = component.text()

    expect(text).toContain('Test Deck')
    expect(text).toContain('Meine Notizen')
    expect(text).toContain('4 Karten insgesamt')

    expect(text).toContain('Main Deck')
    expect(text).toContain('3/40–60')
    expect(text).toContain('1/15')
    expect(text).toContain('Noch keine Karten im Side Deck.')

    expect(text).toContain('Das Main Deck hat 3 Karten, mindestens 40 sind üblich.')
    expect(text).toContain('Zurück zu den Decks')
  })

  it('marks an undersized section amber and an oversized one red', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({
      main: [row({ name: 'Pot of Greed', section: 'main', catalogCardId: 55144522, type: 'Spell Card', quantity: 3, owned: 3, usedInDeck: 3 })],
      extra: [row({ name: 'Stardust Dragon', section: 'extra', catalogCardId: 44508094, type: 'Synchro Monster', quantity: 16, owned: 16, usedInDeck: 16 })],
    })

    const component = await mountSuspended(DeckEditorPage)

    const mainCount = component.find('[aria-label="Anzahl im Main Deck"]')
    expect(mainCount.text()).toBe('3/40–60')
    expect(mainCount.classes()).toContain('text-amber-600')

    const extraCount = component.find('[aria-label="Anzahl im Extra Deck"]')
    expect(extraCount.text()).toBe('16/15')
    expect(extraCount.classes()).toContain('text-red-600')
  })

  it('highlights a shortfall on the owned indicator', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({
      main: [
        row({ name: 'Dark Magician', section: 'main', quantity: 3, owned: 2, usedInDeck: 3, shortfall: 1 }),
        row({ name: 'Pot of Greed', section: 'main', catalogCardId: 55144522, type: 'Spell Card', quantity: 1, owned: 4, usedInDeck: 1 }),
      ],
    })

    const component = await mountSuspended(DeckEditorPage)

    const indicators = component.findAll('span[title], span.tabular-nums')
    const shortfallIndicator = indicators.find(element => element.text() === '3/2')
    expect(shortfallIndicator).toBeTruthy()
    expect(shortfallIndicator!.classes()).toContain('text-red-600')
    expect(shortfallIndicator!.attributes('title')).toBe('Du besitzt nur 2')

    const okIndicator = indicators.find(element => element.text() === '1/4')
    expect(okIndicator).toBeTruthy()
    expect(okIndicator!.classes()).not.toContain('text-red-600')
    expect(okIndicator!.attributes('title')).toBeUndefined()
  })

  it('disables the sections a card may not be added to and shows owned/in-deck counts', async () => {
    state.deck = deckDetail({
      main: [row({ name: 'Dark Magician', section: 'main', quantity: 2, owned: 2, usedInDeck: 2 })],
    })
    state.source = {
      items: [
        {
          catalogCardId: 46986414,
          name: 'Dark Magician',
          type: 'Normal Monster',
          attribute: 'DARK',
          race: 'Spellcaster',
          level: 7,
          imageSmall: null,
          totalQuantity: 2,
        },
        {
          catalogCardId: 44508094,
          name: 'Stardust Dragon',
          type: 'Synchro Monster',
          attribute: 'WIND',
          race: 'Dragon',
          level: 8,
          imageSmall: null,
          totalQuantity: 1,
        },
      ],
      total: 2,
    }

    const component = await mountSuspended(DeckEditorPage)

    expect(component.text()).toContain('Aus Inventar hinzufügen')
    expect(component.text()).toContain('Auch Katalogkarten anzeigen')
    // Owned quantity and how many copies are already in this deck.
    expect(component.text()).toContain('Besitz: 2')

    const buttonFor = (card: string, section: string) =>
      component.find(`[aria-label="${card} zum ${section} hinzufügen"]`)

    // A main-deck card cannot go into the extra deck, and vice versa.
    expect(buttonFor('Dark Magician', 'Main Deck').attributes('disabled')).toBeUndefined()
    expect(buttonFor('Dark Magician', 'Extra Deck').attributes('disabled')).toBeDefined()
    expect(buttonFor('Dark Magician', 'Side Deck').attributes('disabled')).toBeUndefined()

    expect(buttonFor('Stardust Dragon', 'Main Deck').attributes('disabled')).toBeDefined()
    expect(buttonFor('Stardust Dragon', 'Extra Deck').attributes('disabled')).toBeUndefined()
    expect(buttonFor('Stardust Dragon', 'Side Deck').attributes('disabled')).toBeUndefined()
  })

  it('offers a quantity stepper and a remove action per deck row', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({
      main: [row({ name: 'Dark Magician', section: 'main', quantity: 2, owned: 2, usedInDeck: 2 })],
    })

    const component = await mountSuspended(DeckEditorPage)

    expect(component.find('[aria-label="Anzahl von Dark Magician im Main Deck"]').exists()).toBe(true)
    expect(component.find('[aria-label="Eine Kopie von Dark Magician zum Main Deck hinzufügen"]').exists()).toBe(true)
    expect(component.find('[aria-label="Eine Kopie von Dark Magician aus dem Main Deck entfernen"]').exists()).toBe(true)
    expect(component.find('[aria-label="Dark Magician aus dem Main Deck entfernen"]').exists()).toBe(true)
    expect(component.find('[aria-label="Dark Magician verschieben"]').exists()).toBe(true)
  })
})

describe('deck editor mutations', () => {
  // The page also runs through Nuxt's session helpers, which use `$fetch`
  // too — only deck writes go to the handler under test.
  function stubDeckFetch(handler: (url: string, options?: Record<string, unknown>) => Promise<unknown>) {
    const mock = vi.fn((url: string, options?: Record<string, unknown>) => (
      url.startsWith('/api/decks/')
        ? handler(url, options)
        : Promise.resolve(null)
    ))
    vi.stubGlobal('$fetch', mock)
    return mock
  }

  function deckCalls(mock: ReturnType<typeof stubDeckFetch>) {
    return mock.mock.calls.filter(([url]) => String(url).startsWith('/api/decks/'))
  }

  function darkMagicianDeck(quantity: number) {
    return deckDetail({
      main: [row({ name: 'Dark Magician', section: 'main', quantity, owned: 3, usedInDeck: quantity })],
    })
  }

  it('sends the incremented quantity and locks the controls while the write is in flight', async () => {
    state.source = {
      items: [{
        catalogCardId: 46986414,
        name: 'Dark Magician',
        type: 'Normal Monster',
        attribute: 'DARK',
        race: 'Spellcaster',
        level: 7,
        imageSmall: null,
        totalQuantity: 3,
      }],
      total: 1,
    }
    state.deck = darkMagicianDeck(1)

    let resolveRequest: ((detail: unknown) => void) | undefined
    const fetchMock = stubDeckFetch(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))

    const component = await mountSuspended(DeckEditorPage)
    const plusLabel = '[aria-label="Eine Kopie von Dark Magician zum Main Deck hinzufügen"]'
    const addLabel = '[aria-label="Dark Magician zum Main Deck hinzufügen"]'

    await component.find(plusLabel).trigger('click')

    expect(deckCalls(fetchMock)).toEqual([[
      '/api/decks/deck-1/cards',
      { method: 'PUT', body: { catalogCardId: 46986414, section: 'main', quantity: 2 } },
    ]])

    await component.vm.$nextTick()

    // While the write is in flight every mutating control is locked, so a
    // second click cannot compute from the stale rendered quantity.
    expect(component.find(plusLabel).attributes('disabled')).toBeDefined()
    expect(component.find(addLabel).attributes('disabled')).toBeDefined()
    expect(component.find('[aria-label="Anzahl von Dark Magician im Main Deck"]').attributes('disabled')).toBeDefined()

    await component.find(plusLabel).trigger('click')
    expect(deckCalls(fetchMock)).toHaveLength(1)

    resolveRequest!(darkMagicianDeck(2))
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.find('[aria-label="Anzahl im Main Deck"]').text()).toBe('2/40–60')
    expect(component.find(plusLabel).attributes('disabled')).toBeUndefined()
    expect(component.find(addLabel).attributes('disabled')).toBeUndefined()
  })

  it('ignores a stale response that a newer write already superseded', async () => {
    state.source = { items: [], total: 0 }
    state.deck = darkMagicianDeck(1)

    const resolvers: Array<(detail: unknown) => void> = []
    stubDeckFetch(() => new Promise((resolve) => {
      resolvers.push(resolve)
    }))

    const component = await mountSuspended(DeckEditorPage)
    const minusLabel = '[aria-label="Eine Kopie von Dark Magician aus dem Main Deck entfernen"]'

    // First write starts, then a second one is issued once the first settled
    // (the guard only blocks while in flight).
    await component.find(minusLabel).trigger('click')
    resolvers[0]!(darkMagicianDeck(0))
    await flushPromises()

    await component.find('[aria-label="Eine Kopie von Dark Magician zum Main Deck hinzufügen"]').trigger('click')
    // The *first* request answers late: its result must be dropped.
    resolvers[0]!(darkMagicianDeck(42))
    resolvers[1]!(darkMagicianDeck(7))
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.find('[aria-label="Anzahl im Main Deck"]').text()).toBe('7/40–60')
  })

  it('surfaces a rejected write and keeps the deck unchanged', async () => {
    state.source = { items: [], total: 0 }
    state.deck = darkMagicianDeck(1)

    stubDeckFetch(() => Promise.reject(new Error('Extra deck cards can only be placed in the extra or side section')))

    const component = await mountSuspended(DeckEditorPage)
    await component.find('[aria-label="Eine Kopie von Dark Magician zum Main Deck hinzufügen"]').trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Extra deck cards can only be placed in the extra or side section')
    expect(component.find('[aria-label="Anzahl im Main Deck"]').text()).toBe('1/40–60')
    // Controls are usable again after the failure.
    expect(component.find('[aria-label="Eine Kopie von Dark Magician zum Main Deck hinzufügen"]').attributes('disabled')).toBeUndefined()
  })

  it('ignores an emptied quantity field instead of deleting the card', async () => {
    state.source = { items: [], total: 0 }
    state.deck = darkMagicianDeck(2)

    const fetchMock = stubDeckFetch(() => Promise.resolve(darkMagicianDeck(2)))

    const component = await mountSuspended(DeckEditorPage)
    const input = component.find('input[aria-label="Anzahl von Dark Magician im Main Deck"]')

    await input.setValue('')
    await input.trigger('change')
    await flushPromises()

    expect(deckCalls(fetchMock)).toEqual([])
    await component.vm.$nextTick()
    // The field is re-synced from the stored quantity.
    const resynced = component.find<HTMLInputElement>('input[aria-label="Anzahl von Dark Magician im Main Deck"]')
    expect(resynced.element.value).toBe('2')
  })

  it('shows owned totals for catalog-only cards from the owned-quantities endpoint', async () => {
    state.deck = deckDetail({})
    state.ownedQuantities = { 46986414: 4 }
    state.source = {
      items: [{
        id: 46986414,
        name: 'Dark Magician',
        type: 'Normal Monster',
        frameType: 'normal',
        attribute: 'DARK',
        race: 'Spellcaster',
        level: 7,
        imageSmall: null,
      }],
      total: 1,
    }

    const component = await mountSuspended(DeckEditorPage)
    await component.find('[role="checkbox"]').trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Auch Katalogkarten anzeigen')
    expect(component.text()).toContain('Besitz: 4')
  })
})

describe('deck editor rule validation', () => {
  function validation(overrides: Partial<DeckValidation> = {}): DeckValidation {
    return {
      legal: true,
      issues: [],
      cards: {},
      ...overrides,
    }
  }

  it('shows a neutral state while no format is assigned', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({ main: [row({ name: 'Dark Magician', section: 'main' })] })

    const component = await mountSuspended(DeckEditorPage)

    expect(component.text()).toContain('Regelprüfung')
    expect(component.text()).toContain('Kein Format gewählt')
    expect(component.text()).toContain('Wähle oben ein Format')
  })

  it('renders the legality badge, the issue list, and per-row status badges', async () => {
    state.source = {
      items: [{
        catalogCardId: 55144522,
        name: 'Pot of Greed',
        type: 'Spell Card',
        attribute: null,
        race: 'Normal',
        level: null,
        imageSmall: null,
        totalQuantity: 1,
      }],
      total: 1,
    }
    state.deck = deckDetail(
      {
        main: [
          row({ name: 'Pot of Greed', section: 'main', catalogCardId: 55144522, type: 'Spell Card' }),
          row({ name: 'Dark Magician', section: 'main', quantity: 2, owned: 2, usedInDeck: 2 }),
        ],
      },
      [],
      { id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true },
      validation({
        legal: false,
        issues: [
          { severity: 'error', code: 'card_forbidden', cardId: 55144522, message: 'Pot of Greed ist in diesem Format verboten.' },
          { severity: 'error', code: 'deck_size_min', section: 'main', message: 'Das Main Deck hat 3 Karten, mindestens 40 sind erforderlich.' },
        ],
        cards: {
          55144522: { maxCopies: 0, status: 'forbidden', reasons: ['TCG-Banliste: Forbidden'] },
          46986414: { maxCopies: 3, status: 'unrestricted', reasons: [] },
        },
      }),
    )

    const component = await mountSuspended(DeckEditorPage)
    const text = component.text()

    expect(component.find('[aria-label="Regelprüfung Status"]').text()).toBe('Nicht legal – 2 Probleme')
    expect(text).toContain('Pot of Greed ist in diesem Format verboten.')
    expect(text).toContain('Das Main Deck hat 3 Karten, mindestens 40 sind erforderlich.')

    // The forbidden card is badged (in the deck list *and* the card picker)
    // and its row is highlighted; the legal card is not.
    expect(text).toContain('Verboten')
    const forbiddenRows = component.findAll('li').filter(item => item.classes().includes('bg-red-50'))
    expect(forbiddenRows).toHaveLength(1)
    expect(forbiddenRows[0]!.text()).toContain('Pot of Greed')
  })

  it('shows a green badge for a legal deck', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail(
      { main: [row({ name: 'Dark Magician', section: 'main' })] },
      [],
      { id: 'own-1', name: 'Nur alte Karten', isBuiltin: false },
      validation({ legal: true, cards: { 46986414: { maxCopies: 3, status: 'unrestricted', reasons: [] } } }),
    )

    const component = await mountSuspended(DeckEditorPage)

    expect(component.find('[aria-label="Regelprüfung Status"]').text()).toBe('Legal')
    expect(component.text()).toContain('Das Deck erfüllt alle Regeln von "Nur alte Karten".')
  })

  it('PATCHes the deck when another format is selected and renders the response', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({ main: [row({ name: 'Dark Magician', section: 'main' })] })

    const patched = deckDetail(
      { main: [row({ name: 'Dark Magician', section: 'main' })] },
      [],
      { id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true },
      validation({
        legal: false,
        issues: [{ severity: 'error', code: 'deck_size_min', section: 'main', message: 'Das Main Deck hat 1 Karte, mindestens 40 sind erforderlich.' }],
        cards: {},
      }),
    )

    const fetchMock = vi.fn((url: string) => (
      url.startsWith('/api/decks/') ? Promise.resolve(patched) : Promise.resolve(null)
    ))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(DeckEditorPage)

    // The format select teleports its listbox, so drive its v-model directly.
    const formatSelect = selectWithOption(component.findAllComponents(USelect), '__no_format__')
    expect(formatSelect).toBeTruthy()
    expect(optionLabels(formatSelect!)).toEqual([
      'Kein Format',
      'TCG Advanced',
      'Nur alte Karten (eigenes)',
    ])

    await formatSelect!.setValue('tcg-advanced')
    await flushPromises()
    await component.vm.$nextTick()

    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/decks/'))).toEqual([[
      '/api/decks/deck-1',
      { method: 'PATCH', body: { formatId: 'tcg-advanced' } },
    ]])

    expect(component.find('[aria-label="Regelprüfung Status"]').text()).toBe('Nicht legal – 1 Problem')
    vi.unstubAllGlobals()
  })
})
