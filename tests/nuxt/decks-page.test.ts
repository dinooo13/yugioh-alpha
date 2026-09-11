import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DecksPage from '~/pages/decks/index.vue'

interface DeckListItem {
  id: string
  name: string
  description: string | null
  mainCount: number
  extraCount: number
  sideCount: number
  cardCount: number
  complete: boolean
  missingCount: number
  createdAt: string
  updatedAt: string
}

const state = vi.hoisted(() => ({
  decks: { items: [] as DeckListItem[], total: 0, page: 1, pageSize: 20 },
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/decks') {
      return { data: ref(state.decks), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

function deck(overrides: Partial<DeckListItem> = {}): DeckListItem {
  return {
    id: 'deck-1',
    name: 'Test Deck',
    description: null,
    mainCount: 40,
    extraCount: 1,
    sideCount: 0,
    cardCount: 41,
    complete: true,
    missingCount: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('decks page', () => {
  it('renders the search field, sort select, and a create button', async () => {
    state.decks = { items: [deck()], total: 1, page: 1, pageSize: 20 }

    const component = await mountSuspended(DecksPage)

    expect(component.find('input[aria-label="Decks durchsuchen"]').exists()).toBe(true)
    expect(component.find('[aria-label="Sortierung"]').exists()).toBe(true)
    expect(component.text()).toContain('Neues Deck')
    expect(component.text()).toContain('1 Deck')
  })

  it('shows per-section counts and a completeness badge per deck', async () => {
    state.decks = {
      items: [
        deck({ id: 'deck-1', name: 'Vollständiges Deck', mainCount: 40, extraCount: 15, sideCount: 15, cardCount: 70 }),
        deck({
          id: 'deck-2',
          name: 'Unvollständiges Deck',
          mainCount: 3,
          extraCount: 1,
          sideCount: 0,
          cardCount: 4,
          complete: false,
          missingCount: 1,
        }),
        deck({
          id: 'deck-3',
          name: 'Sehr unvollständig',
          complete: false,
          missingCount: 4,
        }),
        deck({
          id: 'deck-4',
          name: 'Leeres Deck',
          mainCount: 0,
          extraCount: 0,
          sideCount: 0,
          cardCount: 0,
          complete: false,
          missingCount: 0,
        }),
      ],
      total: 4,
      page: 1,
      pageSize: 20,
    }

    const component = await mountSuspended(DecksPage)
    const text = component.text()

    expect(text).toContain('Vollständiges Deck')
    expect(text).toContain('Main')
    expect(text).toContain('Extra')
    expect(text).toContain('Side')
    expect(text).toContain('70 Karten')

    expect(text).toContain('Vollständig')
    expect(text).toContain('1 fehlt')
    expect(text).toContain('4 fehlen')
    // An empty deck is neither "complete" nor missing anything.
    expect(text).toContain('Leer')

    // Each deck links into its editor.
    const links = component.findAll('a').map(link => link.attributes('href'))
    expect(links).toContain('/decks/deck-2')
  })

  it('shows the empty state when the user has no decks', async () => {
    state.decks = { items: [], total: 0, page: 1, pageSize: 20 }

    const component = await mountSuspended(DecksPage)

    expect(component.text()).toContain('Noch keine Decks')
    expect(component.text()).not.toContain('Keine Decks gefunden')
  })
})
