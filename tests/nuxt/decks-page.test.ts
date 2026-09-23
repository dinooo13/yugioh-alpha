import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { DecksDeckFormModal, USelect } from '#components'
import DecksPage from '~/pages/decks/index.vue'
import { optionLabels, selectWithOption } from './fixtures/select-wrapper'
import type { DeckCover } from '~~/shared/deck-cover'

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
  formatId: string | null
  formatName: string | null
  legal: boolean | null
  cover: DeckCover | null
  createdAt: string
  updatedAt: string
}

// The global auth middleware would bounce `route: '/decks?new=1'` to /login
// without a session — stub it so the page sees its own query.
vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve({ session: {}, user: { email: 'fabian@example.com', name: 'Fabian Meyer' } })),
}))

const state = vi.hoisted(() => ({
  decks: { items: [] as DeckListItem[], total: 0, page: 1, pageSize: 20 },
  formats: { items: [{ id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true }] },
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/decks') {
      return { data: ref(state.decks), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/formats') {
      return { data: ref(state.formats), pending: ref(false), error: ref(null), refresh: vi.fn() }
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
    formatId: null,
    formatName: null,
    legal: null,
    cover: {
      catalogCardId: 46986414,
      name: 'Dark Magician',
      imageSmall: 'https://images.example/cards_small/46986414.jpg',
      imageLarge: 'https://images.example/cards/46986414.jpg',
    },
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

  it('links "Mit KI erstellen" into the chat assistant with the new-deck intent', async () => {
    state.decks = { items: [], total: 0, page: 1, pageSize: 20 }

    const component = await mountSuspended(DecksPage)

    const link = component.findAll('a').find(anchor => anchor.text().includes('Mit KI erstellen'))
    expect(link).toBeTruthy()
    expect(link!.attributes('href')).toBe('/assistant?intent=new-deck')
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

    expect(text).toContain('Alle Karten im Besitz')
    expect(text).toContain('1 fehlt im Besitz')
    expect(text).toContain('4 fehlen im Besitz')
    // An empty deck is neither "complete" nor missing anything.
    expect(text).toContain('Leer')

    // Each deck links into its editor.
    const links = component.findAll('a').map(link => link.attributes('href'))
    expect(links).toContain('/decks/deck-2')
  })

  it('shows the cover card on each deck tile, and an "Leer" placeholder for a deck without one (#29)', async () => {
    state.decks = {
      items: [
        deck(),
        deck({ id: 'deck-2', name: 'Leeres Deck', mainCount: 0, extraCount: 0, cardCount: 0, cover: null }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    }

    const component = await mountSuspended(DecksPage)

    const cover = component.find('img[src="https://images.example/cards_small/46986414.jpg"]')
    expect(cover.exists()).toBe(true)
    expect(cover.attributes('alt')).toBe('Dark Magician')
    // The cover link is decorative (the deck name is the real link).
    expect(cover.element.closest('a')?.getAttribute('aria-hidden')).toBe('true')
    expect(cover.element.closest('a')?.getAttribute('tabindex')).toBe('-1')

    expect(component.find('[role="img"][aria-label="Leeres Deck: Leer"]').exists()).toBe(true)
  })

  it('shows the empty state when the user has no decks', async () => {
    state.decks = { items: [], total: 0, page: 1, pageSize: 20 }

    const component = await mountSuspended(DecksPage)

    expect(component.text()).toContain('Noch keine Decks')
    expect(component.text()).not.toContain('Keine Decks gefunden')
  })
})

describe('decks page rule formats', () => {
  it('shows the format name and its legality badge', async () => {
    state.decks = {
      items: [
        deck({ id: 'deck-1', name: 'Legales Deck', formatId: 'tcg-advanced', formatName: 'TCG Advanced', legal: true }),
        deck({ id: 'deck-2', name: 'Illegales Deck', formatId: 'own-1', formatName: 'Nur alte Karten', legal: false }),
        deck({ id: 'deck-3', name: 'Formatloses Deck' }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    }

    const component = await mountSuspended(DecksPage)
    const text = component.text()

    expect(text).toContain('TCG Advanced')
    expect(text).toContain('Nur alte Karten')
    expect(text).toContain('Legal')
    expect(text).toContain('Nicht legal')

    const cards = component.findAll('li').filter(item => item.text().includes('Formatloses Deck'))
    expect(cards).toHaveLength(1)
    expect(cards[0]!.text()).not.toContain('Legal')
  })

  it('offers a format filter built from the available formats', async () => {
    state.decks = { items: [deck()], total: 1, page: 1, pageSize: 20 }

    const component = await mountSuspended(DecksPage)

    const formatSelect = selectWithOption(component.findAllComponents(USelect), '__all_formats__')

    expect(formatSelect).toBeTruthy()
    expect(optionLabels(formatSelect!)).toEqual([
      'Alle Formate',
      'Ohne Format',
      'TCG Advanced',
    ])
  })

  it('opens the create modal straight away for /decks?new=1', async () => {
    state.decks = { items: [deck()], total: 1, page: 1, pageSize: 20 }

    const component = await mountSuspended(DecksPage, { route: '/decks?new=1' })
    await nextTick()

    const modal = component.findComponent(DecksDeckFormModal)
    expect(modal.props('open')).toBe(true)
    expect(modal.props('initialValues')).toBeNull()
  })

  it('keeps the create modal closed without the query flag', async () => {
    state.decks = { items: [deck()], total: 1, page: 1, pageSize: 20 }

    const component = await mountSuspended(DecksPage, { route: '/decks' })
    await nextTick()

    expect(component.findComponent(DecksDeckFormModal).props('open')).toBe(false)
  })
})

describe('deck form modal', () => {
  it('ties the empty-name error to the name field', async () => {
    document.body.innerHTML = ''
    await mountSuspended(DecksDeckFormModal, {
      props: { open: true, initialValues: null },
    })

    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await nextTick()

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Deckname"]')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby')!.split(' ')
    const messages = describedBy.map(id => document.getElementById(id)?.textContent?.trim())
    expect(messages).toContain('Bitte einen Namen angeben.')
    // Server errors keep their own live region; nothing to announce yet.
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})
