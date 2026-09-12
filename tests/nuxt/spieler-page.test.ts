import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SpielerIndexPage from '~/pages/spieler/[handle]/index.vue'
import SpielerDeckPage from '~/pages/spieler/[handle]/decks/[id].vue'
import type { PublicProfileResponse, SharedDeckView } from '~~/shared/sharing'

const state = vi.hoisted(() => ({
  profile: null as PublicProfileResponse | null,
  deck: null as SharedDeckView | null,
  error: null as Error | null,
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
  return () => ({ params: { handle: 'fabian', id: 'deck-1' }, query: {} })
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
  })
})
