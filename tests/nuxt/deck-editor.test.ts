import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { DecksDeckFormModal, UApp, UDropdownMenu, USelect } from '#components'
import DeckEditorPage from '~/pages/decks/[id].vue'
import { optionLabels, selectWithOption } from './fixtures/select-wrapper'
import type { DeckValidation } from '~~/shared/rule-formats'
import { setTestLocale } from './fixtures/locale'

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
  nameDe?: string | null
  retired?: boolean
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
  warnings: Array<{ code: string, message: string, params?: Record<string, unknown> }> = [],
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
    cover: null as { catalogCardId: number, name: string, imageSmall: string | null, imageLarge: string | null } | null,
    coverIsChosen: false,
    inactiveCoverChoice: null as { catalogCardId: number, name: string, imageSmall: string | null, imageLarge: string | null } | null,
  }
}

// mountSuspended leaves every page mounted; unmount it after each test so a
// later locale switch doesn't re-render all earlier pages.
enableAutoUnmount(afterEach)

afterEach(async () => {
  await setTestLocale('de')
  state.formats = {
    items: [
      { id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true },
      { id: 'own-1', name: 'Nur alte Karten', isBuiltin: false },
    ],
  }
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

    // No entry point into the assistant (ADR 0021).
    expect(component.find('a[href^="/assistant"]').exists()).toBe(false)
    expect(text).not.toContain('Mit KI')
  })

  it('marks an undersized and an oversized section', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({
      main: [row({ name: 'Pot of Greed', section: 'main', catalogCardId: 55144522, type: 'Spell Card', quantity: 3, owned: 3, usedInDeck: 3 })],
      extra: [row({ name: 'Stardust Dragon', section: 'extra', catalogCardId: 44508094, type: 'Synchro Monster', quantity: 16, owned: 16, usedInDeck: 16 })],
    })

    const component = await mountSuspended(DeckEditorPage)

    const mainCount = component.find('[aria-label="Anzahl im Main Deck"]')
    expect(mainCount.text()).toBe('3/40–60')
    expect(mainCount.attributes('data-state')).toBe('under')

    const extraCount = component.find('[aria-label="Anzahl im Extra Deck"]')
    expect(extraCount.text()).toBe('16/15')
    expect(extraCount.attributes('data-state')).toBe('over')
  })

  it('keeps the retired-card warning when a format validates the deck, and only that one (#109)', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail(
      { main: [row({ name: 'Old Placeholder', section: 'main', catalogCardId: 101402013, retired: true })] },
      [
        { code: 'main_below_min', message: 'x', params: { section: 'main', count: 3, min: 40 } },
        { code: 'card_retired', message: 'x', params: { cardId: 101402013, cardName: 'Old Placeholder' } },
      ],
      { id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true },
      { legal: true, issues: [], cards: {} },
    )

    const component = await mountSuspended(DeckEditorPage)
    const text = component.text()

    expect(text).toContain('Hinweise zum Deckaufbau')
    expect(text).toContain('Old Placeholder ist nicht mehr im Katalog; Banlist-Status und Kartendaten werden nicht mehr aktualisiert.')
    expect(text).not.toContain('mindestens 40 sind üblich')
  })

  it('marks a card YGOPRODeck no longer lists, and only that one (ADR 0019)', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({
      main: [
        row({ name: 'Dark Magician', section: 'main' }),
        row({ name: 'Old Placeholder', section: 'main', catalogCardId: 101402013, retired: true }),
      ],
    })

    // Inside UApp, like in the real app.
    const component = await mountSuspended(defineComponent({
      setup: () => () => h(UApp, null, { default: () => h(DeckEditorPage) }),
    }))

    const badges = component.findAll('[data-testid="card-retired-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.text()).toBe('Nicht mehr im Katalog')
    const rows = component.findAll('li')
    expect(rows.find(item => item.text().includes('Old Placeholder'))!.text()).toContain('Nicht mehr im Katalog')
    expect(rows.find(item => item.text().includes('Dark Magician'))!.text()).not.toContain('Nicht mehr im Katalog')
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
    expect(shortfallIndicator!.attributes('data-shortfall')).toBeDefined()
    expect(shortfallIndicator!.attributes('title')).toBe('Du besitzt nur 2')

    const okIndicator = indicators.find(element => element.text() === '1/4')
    expect(okIndicator).toBeTruthy()
    expect(okIndicator!.attributes('data-shortfall')).toBeUndefined()
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

  it('names deck rows and add-panel cards in the card language (ADR 0015)', async () => {
    state.deck = deckDetail({
      main: [row({ name: 'Dark Magician', nameDe: 'Dunkler Magier', section: 'main', quantity: 2, owned: 2, usedInDeck: 2 })],
    })
    state.source = {
      items: [{
        catalogCardId: 44508094,
        name: 'Stardust Dragon',
        nameDe: 'Sternenstaubdrache',
        type: 'Synchro Monster',
        attribute: 'WIND',
        race: 'Dragon',
        level: 8,
        imageSmall: null,
        totalQuantity: 1,
      }],
      total: 1,
    }

    const german = await mountSuspended(DeckEditorPage)
    expect(german.text()).toContain('Dunkler Magier')
    expect(german.text()).toContain('Sternenstaubdrache')
    expect(german.text()).not.toContain('Dark Magician')
    expect(german.find('[aria-label="Sternenstaubdrache zum Extra Deck hinzufügen"]').exists()).toBe(true)
    german.unmount()

    useState('card-locale-choice').value = 'en'
    const english = await mountSuspended(DeckEditorPage)
    expect(english.text()).toContain('Dark Magician')
    expect(english.text()).toContain('Stardust Dragon')
    expect(english.text()).not.toContain('Dunkler Magier')
    english.unmount()
    useState('card-locale-choice').value = null
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
    expect(component.find('[aria-label="Optionen für Dark Magician"]').exists()).toBe(true)
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

    // The API's error code is shown translated, never its technical
    // statusMessage (ADR 0014).
    stubDeckFetch(() => Promise.reject(Object.assign(new Error('[PUT] "/api/decks/deck-1/cards": 400'), {
      data: {
        statusMessage: 'Extra deck cards can only be placed in the extra or side section',
        data: { code: 'section_not_allowed' },
      },
    })))

    const component = await mountSuspended(DeckEditorPage)
    await component.find('[aria-label="Eine Kopie von Dark Magician zum Main Deck hinzufügen"]').trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Diese Karte kann nicht in diesen Deckbereich.')
    expect(component.text()).not.toContain('Extra deck cards can only be placed')
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

describe('deck editor add panel layout', () => {
  const searchInput = '[aria-label="Karten für das Deck suchen"]'
  const toggle = '[aria-controls="deck-add-panel-body"]'

  it('renders the deck sections before the add panel', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({ main: [row({ name: 'Dark Magician', section: 'main' })] })

    const component = await mountSuspended(DeckEditorPage)
    const text = component.text()

    expect(text.indexOf('Noch keine Karten im Side Deck.')).toBeGreaterThan(-1)
    expect(text.indexOf('Noch keine Karten im Side Deck.')).toBeLessThan(text.indexOf('Aus Inventar hinzufügen'))
  })

  it('collapses the add panel on small screens once the deck has cards', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({ main: [row({ name: 'Dark Magician', section: 'main' })] })

    const component = await mountSuspended(DeckEditorPage)
    const body = () => component.find('#deck-add-panel-body')

    // Hidden below `lg`, always shown from `lg` up — and still in the DOM.
    expect(body().classes()).toContain('hidden')
    expect(body().classes()).toContain('lg:flex')
    expect(component.find(toggle).attributes('aria-expanded')).toBe('false')
    expect(component.find(toggle).text()).toContain('Anzeigen')
    expect(component.find(searchInput).exists()).toBe(true)

    await component.find(toggle).trigger('click')

    expect(body().classes()).not.toContain('hidden')
    expect(component.find(toggle).attributes('aria-expanded')).toBe('true')
    expect(component.find(toggle).text()).toContain('Ausblenden')
    expect(component.find(searchInput).exists()).toBe(true)
  })

  it('starts expanded for an empty deck', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({})

    const component = await mountSuspended(DeckEditorPage)

    expect(component.find('#deck-add-panel-body').classes()).not.toContain('hidden')
    expect(component.find(toggle).attributes('aria-expanded')).toBe('true')
  })

  it('opens and scrolls to the add panel from the header shortcut', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({ main: [row({ name: 'Dark Magician', section: 'main' })] })

    const originalScrollIntoView = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    try {
      const component = await mountSuspended(DeckEditorPage)
      expect(component.find('#deck-add-panel-body').classes()).toContain('hidden')

      const shortcut = component.findAll('button').find(button => button.text() === 'Karten hinzufügen')
      expect(shortcut).toBeTruthy()
      await shortcut!.trigger('click')
      await flushPromises()

      expect(component.find('#deck-add-panel-body').classes()).not.toContain('hidden')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    }
    finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
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
          { severity: 'error', code: 'card_forbidden', cardId: 55144522, params: { cardId: 55144522, cardName: 'Pot of Greed' }, message: 'Pot of Greed is forbidden in this format.' },
          { severity: 'error', code: 'deck_size_min', section: 'main', params: { section: 'main', count: 3, min: 40 }, message: 'The Main Deck has 3 cards; at least 40 are required.' },
        ],
        cards: {
          55144522: { maxCopies: 0, status: 'forbidden', reasons: [{ kind: 'banlist', source: 'tcg', raw: 'Forbidden' }] },
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
    const forbiddenRows = component.findAll('li').filter(item => item.attributes('data-issue') !== undefined)
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
        issues: [{ severity: 'error', code: 'deck_size_min', section: 'main', params: { section: 'main', count: 1, min: 40 }, message: 'The Main Deck has 1 card; at least 40 are required.' }],
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

describe('deck editor header and row layout', () => {
  it('keeps rename and delete in the "Weitere Aktionen" menu at every width', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({ main: [row({ name: 'Dark Magician', section: 'main' })] })

    const component = await mountSuspended(DeckEditorPage)
    const buttonTexts = component.findAll('button').map(button => button.text())

    // No standalone buttons: one code path, no duplicate markup per breakpoint.
    expect(buttonTexts).not.toContain('Umbenennen')
    expect(buttonTexts).not.toContain('Löschen')
    expect(component.find('[aria-label="Weitere Aktionen"]').exists()).toBe(true)
    expect(component.find('[aria-label="Weitere Aktionen"]').classes()).toContain('tap-target')

    // The menu teleports its content, so drive its items directly.
    const menus = component.findAllComponents(UDropdownMenu) as unknown as Array<{ props: (key: string) => unknown }>
    const menu = menus.find(candidate =>
      (candidate.props('items') as Array<Array<{ label: string }>>).flat().some(item => item.label === 'Umbenennen'))
    expect(menu).toBeTruthy()
    const items = (menu!.props('items') as Array<Array<{ label: string, onSelect: () => void }>>).flat()
    expect(items.map(item => item.label)).toEqual(['Umbenennen', 'Löschen'])

    expect(component.findComponent(DecksDeckFormModal).props('open')).toBe(false)
    items[0]!.onSelect()
    await component.vm.$nextTick()
    expect(component.findComponent(DecksDeckFormModal).props('open')).toBe(true)
  })

  it('lets a long deck name wrap instead of truncating it', async () => {
    state.source = { items: [], total: 0 }
    state.deck = deckDetail({})

    const component = await mountSuspended(DeckEditorPage)

    expect(component.findAll('h1')).toHaveLength(1)
    expect(component.find('h1').text()).toBe('Test Deck')
    expect(component.find('h1').classes()).not.toContain('truncate')
  })

  it('gives the row controls and the add buttons 44px tap targets on phones', async () => {
    state.deck = deckDetail({ main: [row({ name: 'Dark Magician', section: 'main' })] })
    state.source = {
      items: [{
        catalogCardId: 46986414,
        name: 'Dark Magician',
        type: 'Normal Monster',
        attribute: 'DARK',
        race: 'Spellcaster',
        level: 7,
        imageSmall: null,
        totalQuantity: 1,
      }],
      total: 1,
    }

    const component = await mountSuspended(DeckEditorPage)

    for (const label of [
      'Eine Kopie von Dark Magician aus dem Main Deck entfernen',
      'Eine Kopie von Dark Magician zum Main Deck hinzufügen',
      'Optionen für Dark Magician',
      'Dark Magician aus dem Main Deck entfernen',
      'Dark Magician zum Main Deck hinzufügen',
      'Dark Magician zum Extra Deck hinzufügen',
      'Dark Magician zum Side Deck hinzufügen',
    ]) {
      expect(component.find(`[aria-label="${label}"]`).classes(), label).toContain('tap-target')
    }
    expect(component.find('[aria-controls="deck-add-panel-body"]').classes()).toContain('tap-target')

    // The full name stays available when it wraps onto a second line.
    expect(component.find('p[title="Dark Magician"]').classes()).toContain('line-clamp-2')
  })
})

describe('deck editor cover card', () => {
  const DARK_MAGICIAN = 46986414
  const POT_OF_GREED = 55144522

  type MenuItem = { label: string, icon?: string, disabled?: boolean, onSelect: () => void }
  type MenuWrapper = { props: (key: string) => unknown }

  function stubDeckFetch(handler: (url: string, options?: Record<string, unknown>) => Promise<unknown>) {
    const mock = vi.fn((url: string, options?: Record<string, unknown>) => (
      url.startsWith('/api/decks/')
        ? handler(url, options)
        : Promise.resolve(null)
    ))
    vi.stubGlobal('$fetch', mock)
    return mock
  }

  function coverOf(catalogCardId: number, name: string) {
    return { catalogCardId, name, imageSmall: null, imageLarge: null }
  }

  /** Dark Magician in Main and Side, Pot of Greed in Main; the rule picks Dark Magician. */
  function coverDeck(cover: { id: number, name: string } | null = { id: DARK_MAGICIAN, name: 'Dark Magician' }, coverIsChosen = false) {
    return {
      ...deckDetail({
        main: [
          row({ name: 'Dark Magician', section: 'main', usedInDeck: 2 }),
          row({ catalogCardId: POT_OF_GREED, name: 'Pot of Greed', type: 'Spell Card', frameType: 'spell', attribute: null, race: 'Normal', level: null, atk: null, def: null, section: 'main' }),
        ],
        side: [row({ name: 'Dark Magician', section: 'side', usedInDeck: 2 })],
      }),
      cover: cover ? coverOf(cover.id, cover.name) : null,
      coverIsChosen,
    }
  }

  // The menus teleport their content, so drive their items directly. A row's
  // move items name the sections it is *not* in.
  function rowMenu(component: Awaited<ReturnType<typeof mountSuspended>>, name: string, section: DeckSection): MenuItem[] {
    const menus = component.findAllComponents(UDropdownMenu) as unknown as Array<MenuWrapper & { find: (selector: string) => { exists: () => boolean } }>
    const others = (['main', 'extra', 'side'] as const)
      .filter(other => other !== section)
      .map(other => `Nach ${{ main: 'Main Deck', extra: 'Extra Deck', side: 'Side Deck' }[other]}`)
    const menu = menus.find((candidate) => {
      const labels = (candidate.props('items') as MenuItem[][]).flat().map(item => item.label)
      return candidate.find(`[aria-label="Optionen für ${name}"]`).exists()
        && others.every(label => labels.includes(label))
    })
    expect(menu, `${name} (${section})`).toBeTruthy()
    return (menu!.props('items') as MenuItem[][]).flat()
  }

  function rowItem(component: Awaited<ReturnType<typeof mountSuspended>>, name: string, section: DeckSection) {
    const sectionLabel = { main: 'Main Deck', extra: 'Extra Deck', side: 'Side Deck' }[section]
    const item = component.findAll('li').find((li: DOMWrapper<Element>) => li.find(`[aria-label="${name} aus dem ${sectionLabel} entfernen"]`).exists())
    expect(item, `${name} (${section})`).toBeTruthy()
    return item!
  }

  it('offers "Als Titelkarte festlegen" in Main/Extra row menus, next to the moves, but not for Side rows', async () => {
    state.source = { items: [], total: 0 }
    state.deck = coverDeck()

    const component = await mountSuspended(DeckEditorPage)

    const potMenu = rowMenu(component, 'Pot of Greed', 'main')
    expect(potMenu.map(item => item.label)).toEqual(['Nach Extra Deck', 'Nach Side Deck', 'Als Titelkarte festlegen'])

    const sideMenu = rowMenu(component, 'Dark Magician', 'side')
    expect(sideMenu.map(item => item.label)).toEqual(['Nach Main Deck', 'Nach Extra Deck'])

    // The menu button is the "Optionen für …" row menu.
    const button = component.find('[aria-label="Optionen für Pot of Greed"]')
    expect(button.classes()).toContain('tap-target')
  })

  it('PATCHes the chosen cover and shows the response\'s "Titelkarte" badge', async () => {
    state.source = { items: [], total: 0 }
    state.deck = coverDeck()

    const fetchMock = stubDeckFetch(() => Promise.resolve(coverDeck({ id: POT_OF_GREED, name: 'Pot of Greed' }, true)))
    const component = await mountSuspended(DeckEditorPage)

    rowMenu(component, 'Pot of Greed', 'main').find(item => item.label === 'Als Titelkarte festlegen')!.onSelect()
    await flushPromises()
    await component.vm.$nextTick()

    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/decks/'))).toEqual([[
      '/api/decks/deck-1',
      { method: 'PATCH', body: { coverCardId: POT_OF_GREED } },
    ]])
    expect(rowItem(component, 'Pot of Greed', 'main').text()).toContain('Titelkarte')
    expect(rowItem(component, 'Pot of Greed', 'main').text()).not.toContain('Titelkarte (automatisch)')
    expect(rowItem(component, 'Dark Magician', 'main').text()).not.toContain('Titelkarte')
  })

  it('marks a rule-picked cover as automatic on its Main row only, and lets the user pin it', async () => {
    state.source = { items: [], total: 0 }
    state.deck = coverDeck()

    const component = await mountSuspended(DeckEditorPage)

    expect(rowItem(component, 'Dark Magician', 'main').text()).toContain('Titelkarte (automatisch)')
    expect(rowItem(component, 'Dark Magician', 'side').text()).not.toContain('Titelkarte')
    expect(rowItem(component, 'Pot of Greed', 'main').text()).not.toContain('Titelkarte')
    expect(component.findAll('li').filter(li => li.text().includes('Titelkarte'))).toHaveLength(1)

    expect(rowMenu(component, 'Dark Magician', 'main').map(item => item.label)).toContain('Als Titelkarte festlegen')
  })

  it('offers "Titelkarte automatisch wählen" on a chosen cover, which PATCHes null', async () => {
    state.source = { items: [], total: 0 }
    state.deck = coverDeck({ id: POT_OF_GREED, name: 'Pot of Greed' }, true)

    const fetchMock = stubDeckFetch(() => Promise.resolve(coverDeck()))
    const component = await mountSuspended(DeckEditorPage)

    expect(rowItem(component, 'Pot of Greed', 'main').text()).toContain('Titelkarte')

    const potMenu = rowMenu(component, 'Pot of Greed', 'main')
    expect(potMenu.map(item => item.label)).not.toContain('Als Titelkarte festlegen')
    // Other Main rows can still take over as the chosen cover.
    expect(rowMenu(component, 'Dark Magician', 'main').map(item => item.label)).toContain('Als Titelkarte festlegen')

    potMenu.find(item => item.label === 'Titelkarte automatisch wählen')!.onSelect()
    await flushPromises()
    await component.vm.$nextTick()

    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/decks/'))).toEqual([[
      '/api/decks/deck-1',
      { method: 'PATCH', body: { coverCardId: null } },
    ]])
    expect(rowItem(component, 'Dark Magician', 'main').text()).toContain('Titelkarte (automatisch)')
  })

  it('hints at a chosen cover that is no longer in Main/Extra and clears it (#57)', async () => {
    state.source = { items: [], total: 0 }
    state.deck = { ...coverDeck(), inactiveCoverChoice: coverOf(12580477, 'Raigeki') }

    const fetchMock = stubDeckFetch(() => Promise.resolve(coverDeck()))
    const component = await mountSuspended(DeckEditorPage)

    expect(component.text()).toContain('Gewählte Titelkarte nicht aktiv')
    expect(component.text()).toContain('"Raigeki" ist nicht mehr im Main oder Extra Deck')
    // The rule's pick is still marked as the automatic cover.
    expect(rowItem(component, 'Dark Magician', 'main').text()).toContain('Titelkarte (automatisch)')

    const clear = component.findAll('button').find(button => button.text() === 'Auswahl aufheben')
    expect(clear).toBeTruthy()
    await clear!.trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/decks/'))).toEqual([[
      '/api/decks/deck-1',
      { method: 'PATCH', body: { coverCardId: null } },
    ]])
    expect(component.text()).not.toContain('Gewählte Titelkarte nicht aktiv')
  })

  it('shows no inactive-cover hint without a stored choice', async () => {
    state.source = { items: [], total: 0 }
    state.deck = coverDeck()

    const component = await mountSuspended(DeckEditorPage)

    expect(component.text()).not.toContain('Gewählte Titelkarte nicht aktiv')
  })

  it('shows no inactive-cover hint while the chosen cover is active', async () => {
    state.source = { items: [], total: 0 }
    state.deck = coverDeck({ id: POT_OF_GREED, name: 'Pot of Greed' }, true)

    const component = await mountSuspended(DeckEditorPage)

    expect(component.text()).not.toContain('Gewählte Titelkarte nicht aktiv')
  })
})

describe('deck editor add panel paging', () => {
  function inventoryItems(count: number, offset = 0) {
    return Array.from({ length: count }, (_, index) => ({
      catalogCardId: 1000 + offset + index,
      name: `Karte ${String(offset + index + 1).padStart(2, '0')}`,
      type: 'Normal Monster',
      attribute: 'DARK',
      race: 'Spellcaster',
      level: 4,
      imageSmall: null,
      totalQuantity: 1,
    }))
  }

  function catalogItems(count: number, offset = 0) {
    return Array.from({ length: count }, (_, index) => ({
      id: 2000 + offset + index,
      name: `Katalogkarte ${String(offset + index + 1).padStart(2, '0')}`,
      type: 'Normal Monster',
      frameType: 'normal',
      attribute: 'DARK',
      race: 'Spellcaster',
      level: 4,
      imageSmall: null,
    }))
  }

  interface Wrapper {
    findAll: (selector: string) => Array<DOMWrapper<Element>>
  }

  const panelCards = (component: Wrapper) => component.findAll('#deck-add-panel-body li')
  const loadMoreButton = (component: Wrapper) =>
    component.findAll('button').find(button => button.text() === 'Mehr laden')

  function stubSourceFetch(handler: (url: string, options?: { query?: Record<string, unknown> }) => Promise<unknown>) {
    const mock = vi.fn((url: string, options?: { query?: Record<string, unknown> }) => (
      url.startsWith('/api/inventory/') || url.startsWith('/api/catalog/')
        ? handler(url, options)
        : Promise.resolve(null)
    ))
    vi.stubGlobal('$fetch', mock)
    return mock
  }

  it('shows how many of the matches are listed and appends the next page', async () => {
    state.deck = deckDetail({})
    state.source = { items: inventoryItems(12), total: 14 }
    const fetchMock = stubSourceFetch(() => Promise.resolve({ items: inventoryItems(2, 12), total: 14 }))

    const component = await mountSuspended(DeckEditorPage)

    expect(panelCards(component)).toHaveLength(12)
    expect(component.text()).toContain('12 von 14 Karten')
    expect(loadMoreButton(component)).toBeTruthy()

    await loadMoreButton(component)!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/inventory/search', {
      query: expect.objectContaining({ page: 2, pageSize: 12, sort: 'name' }),
    })
    expect(panelCards(component)).toHaveLength(14)
    expect(component.text()).toContain('Karte 14')
    expect(component.text()).toContain('14 Karten')
    expect(component.text()).not.toContain('von 14 Karten')
    expect(loadMoreButton(component)).toBeUndefined()
  })

  it('fetches the owned totals of a further catalog page', async () => {
    state.deck = deckDetail({})
    state.source = { items: catalogItems(12), total: 14 }
    const fetchMock = stubSourceFetch((url) => {
      if (url === '/api/catalog/cards') {
        return Promise.resolve({ items: catalogItems(2, 12), total: 14 })
      }
      if (url === '/api/inventory/owned-quantities') {
        return Promise.resolve({ 2012: 4 })
      }
      return Promise.resolve(null)
    })

    const component = await mountSuspended(DeckEditorPage)
    await component.find('[role="checkbox"]').trigger('click')
    await flushPromises()

    await loadMoreButton(component)!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/catalog/cards', {
      query: expect.objectContaining({ page: 2, pageSize: 12 }),
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/inventory/owned-quantities', { query: { ids: '2012,2013' } })

    const loaded = panelCards(component).find(item => item.text().includes('Katalogkarte 13'))
    expect(loaded).toBeTruthy()
    expect(loaded!.text()).toContain('Besitz: 4')
  })

  it('starts over at the first page when a filter changes', async () => {
    state.deck = deckDetail({})
    state.source = { items: inventoryItems(12), total: 14 }
    stubSourceFetch(() => Promise.resolve({ items: inventoryItems(2, 12), total: 14 }))

    const component = await mountSuspended(DeckEditorPage)
    await loadMoreButton(component)!.trigger('click')
    await flushPromises()
    expect(panelCards(component)).toHaveLength(14)

    await selectWithOption(component.findAllComponents(USelect), '__all_types__')!.setValue('Normal Monster')
    await flushPromises()

    expect(panelCards(component)).toHaveLength(12)
    expect(component.text()).toContain('12 von 14 Karten')
    expect(loadMoreButton(component)).toBeTruthy()
  })

  it('drops a page that arrives after the filters changed', async () => {
    state.deck = deckDetail({})
    state.source = { items: inventoryItems(12), total: 14 }
    let resolvePage: ((page: unknown) => void) | undefined
    stubSourceFetch(() => new Promise((resolve) => {
      resolvePage = resolve
    }))

    const component = await mountSuspended(DeckEditorPage)
    await loadMoreButton(component)!.trigger('click')

    await selectWithOption(component.findAllComponents(USelect), '__all_types__')!.setValue('Normal Monster')
    await flushPromises()

    resolvePage!({ items: inventoryItems(2, 12), total: 14 })
    await flushPromises()

    expect(panelCards(component)).toHaveLength(12)
    expect(component.text()).not.toContain('Karte 13')
    expect(component.text()).toContain('12 von 14 Karten')
    expect(loadMoreButton(component)).toBeTruthy()
  })

  it('reports a failed page and keeps the list', async () => {
    state.deck = deckDetail({})
    state.source = { items: inventoryItems(12), total: 14 }
    stubSourceFetch(() => Promise.reject(new Error('offline')))

    const component = await mountSuspended(DeckEditorPage)
    await loadMoreButton(component)!.trigger('click')
    await flushPromises()

    expect(component.text()).toContain('Weitere Karten konnten nicht geladen werden.')
    expect(panelCards(component)).toHaveLength(12)
    expect(loadMoreButton(component)).toBeTruthy()
  })

  it('offers no "Mehr laden" when every match is listed', async () => {
    state.deck = deckDetail({})
    state.source = { items: inventoryItems(12), total: 12 }

    const component = await mountSuspended(DeckEditorPage)

    expect(panelCards(component)).toHaveLength(12)
    expect(component.text()).toContain('12 Karten')
    expect(component.text()).not.toContain('von 12 Karten')
    expect(loadMoreButton(component)).toBeUndefined()
  })
})

describe('deck editor in English', () => {
  const POT_OF_GREED = 55144522
  const RAIGEKI = 12580477

  function goatDeck() {
    return {
      ...deckDetail(
        {
          main: [
            row({ name: 'Dark Magician', section: 'main' }),
            row({ catalogCardId: POT_OF_GREED, name: 'Pot of Greed', type: 'Spell Card', frameType: 'spell', attribute: null, race: 'Normal', level: null, section: 'main' }),
            row({ catalogCardId: RAIGEKI, name: 'Raigeki', type: 'Spell Card', frameType: 'spell', attribute: null, race: 'Normal', level: null, section: 'main' }),
          ],
        },
        [],
        { id: 'goat', name: 'GOAT Format', isBuiltin: true },
        {
          legal: false,
          issues: [
            { severity: 'error', code: 'deck_size_min', section: 'main', params: { section: 'main', count: 3, min: 40 }, message: 'The Main Deck has 3 cards; at least 40 are required.' },
            { severity: 'error', code: 'card_forbidden', cardId: RAIGEKI, params: { cardId: RAIGEKI, cardName: 'Raigeki' }, message: 'Raigeki is forbidden in this format.' },
          ],
          cards: {
            [POT_OF_GREED]: { maxCopies: 1, status: 'limited', reasons: [{ kind: 'banlist', source: 'goat', raw: 'Limited' }] },
            [RAIGEKI]: {
              maxCopies: 0,
              status: 'forbidden',
              reasons: [{
                kind: 'filter',
                label: 'Only cards up to June 2005',
                rule: { kind: 'filter', match: 'not_matching', filter: { releasedBefore: '2005-07-01' }, maxCopies: 0, label: 'Only cards up to June 2005' },
              }],
            },
          },
        },
      ),
      cover: { catalogCardId: 46986414, name: 'Dark Magician', imageSmall: null, imageLarge: null },
      coverIsChosen: true,
    }
  }

  it('renders the validation issues, status badges, cover badge and row menu in English', async () => {
    state.source = { items: [], total: 0 }
    state.deck = goatDeck()
    state.formats = {
      items: [
        { id: 'goat', name: 'GOAT Format', isBuiltin: true },
        { id: 'unlimited', name: 'No banlist', isBuiltin: true },
        { id: 'own-1', name: 'Nur alte Karten', isBuiltin: false },
      ],
    }
    await setTestLocale('en')

    const component = await mountSuspended(DeckEditorPage)
    const text = component.text()

    expect(component.find('[aria-label="Rule check status"]').text()).toBe('Not legal – 2 issues')
    expect(text).toContain('The Main Deck has 3 cards; at least 40 are required.')
    expect(text).toContain('Raigeki is forbidden in this format.')
    expect(text).toContain('3 cards in total')
    expect(text).toContain('Cover card')
    expect(text).toContain('Add from inventory')
    expect(text).not.toMatch(/Karte|Regel|Titelkarte|Verboten|Limitiert|hinzufügen/)

    // Status badges and their tooltips (the reasons behind the limit).
    const forbidden = component.find('[title="Only cards up to June 2005"]')
    expect(forbidden.exists()).toBe(true)
    expect(forbidden.text()).toBe('Forbidden')
    expect(component.find('[title="GOAT banlist: Limited"]').text()).toBe('Limited (1)')

    const formatSelect = selectWithOption(component.findAllComponents(USelect), '__no_format__')
    expect(optionLabels(formatSelect!)).toEqual(['No format', 'GOAT Format', 'No banlist', 'Nur alte Karten (custom)'])

    const menus = component.findAllComponents(UDropdownMenu) as unknown as Array<{ props: (key: string) => unknown, find: (selector: string) => { exists: () => boolean } }>
    const potMenu = menus.find(menu => menu.find('[aria-label="Options for Pot of Greed"]').exists())
    expect((potMenu!.props('items') as Array<Array<{ label: string }>>).flat().map(item => item.label))
      .toEqual(['Move to Extra Deck', 'Move to Side Deck', 'Set as cover card'])
    expect(component.find('[aria-label="Remove one copy of Dark Magician from the Main Deck"]').exists()).toBe(true)
  })

  it('shows a built-in format\'s German cutoff label in German mode', async () => {
    state.source = { items: [], total: 0 }
    state.deck = goatDeck()

    const component = await mountSuspended(DeckEditorPage)

    expect(component.find('[title="Nur Karten bis Juni 2005"]').text()).toBe('Verboten')
    expect(component.find('[title="GOAT-Banliste: Limited"]').text()).toBe('Limitiert (1)')
    expect(component.text()).toContain('Das Main Deck hat 3 Karten, mindestens 40 sind erforderlich.')
    expect(component.text()).toContain('Titelkarte')
  })
})
