import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DeckEditorPage from '~/pages/decks/[id].vue'

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
    return { data: ref(state.deck), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/decks/deck-1', params: { id: 'deck-1' }, query: {} })
})

function deckDetail(sections: Partial<Record<DeckSection, DeckCardRow[]>>, warnings: Array<{ code: string, message: string }> = []) {
  const full = { main: [], extra: [], side: [], ...sections } as Record<DeckSection, DeckCardRow[]>
  const count = (section: DeckSection) => full[section].reduce((total, card) => total + card.quantity, 0)

  return {
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
