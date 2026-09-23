import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SpielerIndexPage from '~/pages/spieler/[handle]/index.vue'
import SpielerDeckPage from '~/pages/spieler/[handle]/decks/[id].vue'
import type { PublicProfileResponse, SharedDeckView } from '~~/shared/sharing'

const state = vi.hoisted(() => ({
  profile: null as PublicProfileResponse | null,
  deck: null as SharedDeckView | null,
  error: null as Error | null,
  // Consumed by `SharingNotFoundNotice` (mocked module below) to decide
  // whether the "melde dich an" hint should render on the not-found box.
  session: null as { session: unknown, user: { email: string } } | null,
}))

vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve(state.session)),
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl.includes('/decks/')) {
      return { data: ref(state.deck), error: ref(state.error), pending: ref(false), refresh: vi.fn() }
    }
    return { data: ref(state.profile), error: ref(state.error), pending: ref(false), refresh: vi.fn() }
  }
})

mockNuxtImport('useRoute', () => {
  return () => ({ params: { handle: 'fabian', id: 'deck-1' }, query: {}, fullPath: '/spieler/fabian' })
})

afterEach(() => {
  state.session = null
})

function profileResponse(overrides: Partial<PublicProfileResponse> = {}): PublicProfileResponse {
  return {
    profile: { handle: 'fabian', displayName: 'Fabian', bio: 'Sammle Blue-Eyes' },
    viewer: { isAuthenticated: false, isOwner: false },
    decks: [],
    collections: [],
    inventory: { visible: false, cardCount: 0 },
    wishlist: { visible: false, itemCount: 0 },
    ...overrides,
  }
}

describe('public profile page', () => {
  it('renders display name, bio, shared decks, shared collections and the inventory link', async () => {
    state.error = null
    state.profile = profileResponse({
      decks: [{
        id: 'deck-1',
        name: 'Blue-Eyes Deck',
        description: null,
        mainCount: 40,
        extraCount: 0,
        sideCount: 0,
        cardCount: 40,
        formatName: null,
        legal: null,
        visibility: 'public',
        updatedAt: '2025-01-01T00:00:00.000Z',
        cover: {
          catalogCardId: 89631139,
          name: 'Blue-Eyes White Dragon',
          imageSmall: 'https://images.example/cards_small/89631139.jpg',
          imageLarge: 'https://images.example/cards/89631139.jpg',
        },
      }],
      collections: [{ id: 'col-1', name: 'Binder', description: null, cardCount: 10, visibility: 'public' }],
      inventory: { visible: true, cardCount: 120 },
    })

    const component = await mountSuspended(SpielerIndexPage)
    const text = component.text()

    expect(text).toContain('Fabian')
    expect(text).toContain('Sammle Blue-Eyes')
    expect(text).toContain('Blue-Eyes Deck')
    expect(text).toContain('Binder')
    expect(text).toContain('Inventar ansehen')

    // Initials avatar (#29) and the deck tile's cover card.
    expect(component.find('[data-slot="fallback"]').text()).toBe('F')
    expect(component.find('img[src="https://images.example/cards_small/89631139.jpg"]').exists()).toBe(true)
  })

  it('hides the inventory link when the inventory is not visible', async () => {
    state.error = null
    state.profile = profileResponse({ inventory: { visible: false, cardCount: 0 } })

    const component = await mountSuspended(SpielerIndexPage)

    expect(component.text()).not.toContain('Inventar ansehen')
  })

  it('shows the all-empty state for a profile that shares nothing', async () => {
    state.error = null
    state.profile = profileResponse()

    const component = await mountSuspended(SpielerIndexPage)

    expect(component.text()).toContain('Dieses Profil teilt aktuell nichts.')
  })

  it('does not show the owner preview notice to a visitor', async () => {
    state.error = null
    state.profile = profileResponse()

    const component = await mountSuspended(SpielerIndexPage)

    expect(component.text()).not.toContain('Vorschau deines Profils')
    expect(component.text()).not.toContain('Sichtbarkeit verwalten')
  })

  it('shows the owner a preview notice and an owner-specific empty state', async () => {
    state.error = null
    state.profile = profileResponse({ viewer: { isAuthenticated: true, isOwner: true } })

    const component = await mountSuspended(SpielerIndexPage)
    const text = component.text()

    expect(text).toContain('Vorschau deines Profils – private Inhalte siehst nur du.')
    expect(text).toContain('Du teilst aktuell nichts.')
    expect(text).not.toContain('Dieses Profil teilt aktuell nichts.')
    const manageLinks = component.findAll('a[href="/profil"]')
    expect(manageLinks.length).toBe(2)
    expect(manageLinks[0]!.text()).toContain('Sichtbarkeit verwalten')
  })
})

describe('shared not-found notice', () => {
  it('offers an anonymous visitor a login link carrying the current path as redirect', async () => {
    state.error = new Error('Not found')
    state.profile = null
    state.session = null

    const component = await mountSuspended(SpielerIndexPage)
    await component.vm.$nextTick()

    expect(component.text()).toContain('Nicht gefunden oder nicht freigegeben.')
    expect(component.text()).toContain('Falls die Freigabe für dein Konto gilt')
    const loginLink = component.find('a[href^="/login"]')
    expect(loginLink.exists()).toBe(true)
    expect(loginLink.attributes('href')).toBe('/login?redirect=/spieler/fabian')
  })

  it('does not show the login hint to an already signed-in visitor', async () => {
    state.error = new Error('Not found')
    state.profile = null
    state.session = { session: {}, user: { email: 'other@example.com' } }

    const component = await mountSuspended(SpielerIndexPage)
    await component.vm.$nextTick()

    expect(component.text()).toContain('Nicht gefunden oder nicht freigegeben.')
    expect(component.text()).not.toContain('Falls die Freigabe für dein Konto gilt')
  })
})

describe('public deck page', () => {
  it('renders section headings and quantities without ownership or edit affordances for a non-owner', async () => {
    state.error = null
    state.deck = {
      owner: { handle: 'fabian', displayName: 'Fabian', bio: null },
      deck: { id: 'deck-1', name: 'Blue-Eyes Deck', description: null, updatedAt: '2025-01-01T00:00:00.000Z' },
      sections: {
        main: [{
          catalogCardId: 89631139,
          name: 'Blue-Eyes White Dragon',
          type: 'Normal Monster',
          frameType: 'normal',
          attribute: 'LIGHT',
          race: 'Dragon',
          level: 8,
          atk: 3000,
          def: 2500,
          imageSmall: null,
          imageLarge: null,
          section: 'main',
          quantity: 3,
        }],
        extra: [],
        side: [],
      },
      counts: { main: 3, extra: 0, side: 0, total: 3 },
      limits: { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15, maxCopies: 3 },
      warnings: [],
      format: null,
      validation: null,
      isOwner: false,
    }

    const component = await mountSuspended(SpielerDeckPage)
    const text = component.text()

    expect(text).toContain('Main Deck')
    expect(text).toContain('Blue-Eyes White Dragon')
    expect(text).toContain('3×')
    expect(text).not.toContain('besitzt')
    expect(text).not.toContain('fehlt')
    expect(text).not.toContain('Bearbeiten')
    expect(text).toContain('Geteilt von Fabian')
    expect(component.find('[data-slot="fallback"]').text()).toBe('F')
  })

  function baseDeck(overrides: Partial<SharedDeckView> = {}): SharedDeckView {
    return {
      owner: { handle: 'fabian', displayName: 'Fabian', bio: null },
      deck: { id: 'deck-1', name: 'Blue-Eyes Deck', description: null, updatedAt: '2025-01-01T00:00:00.000Z' },
      sections: { main: [], extra: [], side: [] },
      counts: { main: 8, extra: 0, side: 0, total: 8 },
      limits: { mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15, maxCopies: 3 },
      warnings: [{ code: 'main_deck_low', message: 'Das Main Deck hat 8 Karten, mindestens 40 sind üblich.' }],
      format: { id: 'format-1', name: 'Standard', isBuiltin: true },
      validation: {
        legal: false,
        issues: [{ severity: 'error', code: 'deck_size_min', section: 'main', message: 'Das Main Deck hat 8 Karten, mindestens 40 sind erforderlich.' }],
        cards: {},
      },
      isOwner: false,
      ...overrides,
    }
  }

  it('hides the deck-building coaching box from a non-owner but shows the legality issues collapsed under the badge', async () => {
    state.error = null
    state.deck = baseDeck({ isOwner: false })

    const component = await mountSuspended(SpielerDeckPage)
    const text = component.text()

    expect(text).not.toContain('Hinweise zum Deckaufbau')
    expect(text).toContain('Nicht legal')
    expect(text).toContain('Details anzeigen')
    // Collapsed by default — the issue text sits in the (unmounted-on-hide)
    // collapsible content, so it should not yet appear in the rendered text.
    expect(text).not.toContain('mindestens 40 sind erforderlich')

    const detailsButton = component.findAll('button').find(btn => btn.text().includes('Details anzeigen'))
    expect(detailsButton).toBeTruthy()
    await detailsButton!.trigger('click')
    await component.vm.$nextTick()

    expect(component.text()).toContain('mindestens 40 sind erforderlich')
  })

  it('shows the deck-building coaching box to the owner', async () => {
    state.error = null
    state.deck = baseDeck({ isOwner: true })

    const component = await mountSuspended(SpielerDeckPage)

    expect(component.text()).toContain('Hinweise zum Deckaufbau')
  })
})
