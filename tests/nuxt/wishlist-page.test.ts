import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { UApp } from '#components'
import WishlistPage from '~/pages/wishlist.vue'
import AddToWishlistButton from '~/components/wishlist/AddToWishlistButton.vue'
import type { OwnProfile, WishlistItemView, WishlistResponse } from '~~/shared/sharing'

const state = vi.hoisted(() => ({
  wishlist: { items: [], total: 0, page: 1, pageSize: 24 } as WishlistResponse,
  profile: {
    userId: 'user-a',
    handle: 'fabian',
    displayName: 'Fabian',
    bio: null,
    inventoryVisibility: 'private',
    wishlistVisibility: 'private',
    locale: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as OwnProfile,
}))

// `useOwnProfile()` shares its `/api/profile` fetch across every page that
// calls it (see app/composables/useOwnProfile.ts) — the mock has to branch
// on the URL, unlike the page's own single-endpoint fetch it replaced.
mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/profile') {
      return { data: ref(state.profile), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(state.wishlist), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function item(overrides: Partial<WishlistItemView> = {}): WishlistItemView {
  return {
    id: 'wish-1',
    catalogCardId: 1,
    name: 'Kuriboh',
    nameDe: null,
    type: 'Effect Monster',
    imageSmall: null,
    retired: false,
    quantity: 1,
    note: null,
    owned: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('wishlist page', () => {
  it('shows the empty state when there are no items', async () => {
    state.wishlist = { items: [], total: 0, page: 1, pageSize: 24 }

    const component = await mountSuspended(WishlistPage)

    expect(component.text()).toContain('Noch keine Karten auf der Wunschliste.')
  })

  it('lists wishlist items', async () => {
    state.wishlist = { items: [item()], total: 1, page: 1, pageSize: 24 }

    const component = await mountSuspended(WishlistPage)

    expect(component.text()).toContain('Kuriboh')
  })

  it('marks a card YGOPRODeck no longer lists, and only that one (ADR 0019)', async () => {
    state.wishlist = {
      items: [item(), item({ id: 'wish-2', catalogCardId: 2, name: 'Old Placeholder', retired: true })],
      total: 2,
      page: 1,
      pageSize: 24,
    }

    // The badge's tooltip needs the provider UApp gives the real app.
    const component = await mountSuspended(defineComponent({
      setup: () => () => h(UApp, null, { default: () => h(WishlistPage) }),
    }))

    const badges = component.findAll('[data-testid="card-retired-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.text()).toBe('Nicht mehr im Katalog')
    const rows = component.findAll('li')
    expect(rows.find(row => row.text().includes('Old Placeholder'))!.text()).toContain('Nicht mehr im Katalog')
  })

  it('removes a row via DELETE /api/wishlist/:id', async () => {
    state.wishlist = { items: [item()], total: 1, page: 1, pageSize: 24 }
    const fetchMock = vi.fn(() => Promise.resolve(undefined))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(WishlistPage)
    const removeButton = component.findAll('button').find(btn => btn.text().includes('Entfernen'))
    expect(removeButton).toBeTruthy()

    await removeButton!.trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/api/wishlist/wish-1', { method: 'DELETE' })
  })

  it('shows the wishlist\'s own visibility badge and a link to change it on /profile', async () => {
    state.wishlist = { items: [], total: 0, page: 1, pageSize: 24 }
    state.profile = { ...state.profile, wishlistVisibility: 'public' }

    const component = await mountSuspended(WishlistPage)

    expect(component.text()).toContain('Öffentlich')
    expect(component.text()).toContain('Sichtbarkeit ändern')
    const link = component.find('a[href="/profile#wishlist"]')
    expect(link.exists()).toBe(true)
  })

  it('shows the "Privat" badge when the wishlist is not public', async () => {
    state.wishlist = { items: [], total: 0, page: 1, pageSize: 24 }
    state.profile = { ...state.profile, wishlistVisibility: 'private' }

    const component = await mountSuspended(WishlistPage)

    expect(component.text()).toContain('Privat')
  })

  it('disables the minus button once a row reaches quantity 1', async () => {
    state.wishlist = { items: [item({ quantity: 1 })], total: 1, page: 1, pageSize: 24 }

    const component = await mountSuspended(WishlistPage)
    const minusButton = component.find('button[aria-label="Ein Exemplar von Kuriboh entfernen"]')

    expect(minusButton.exists()).toBe(true)
    expect(minusButton.attributes('disabled')).toBeDefined()
  })

  it('keeps the minus button enabled above quantity 1', async () => {
    state.wishlist = { items: [item({ quantity: 2 })], total: 1, page: 1, pageSize: 24 }

    const component = await mountSuspended(WishlistPage)
    const minusButton = component.find('button[aria-label="Ein Exemplar von Kuriboh entfernen"]')

    expect(minusButton.attributes('disabled')).toBeUndefined()
  })
})

describe('add to wishlist button', () => {
  // Presentational since #98: the catalog page owns the state and the
  // request (useWishlistToggle, see wishlist-toggle.test.ts).
  it('shows "Zur Wunschliste" or "Auf der Wunschliste" and emits toggle', async () => {
    const component = await mountSuspended(AddToWishlistButton, {
      props: { inWishlist: false },
    })

    expect(component.text()).toContain('Zur Wunschliste')
    await component.find('button').trigger('click')
    expect(component.emitted('toggle')).toEqual([[]])

    await component.setProps({ inWishlist: true })
    expect(component.text()).toContain('Auf der Wunschliste')
  })

  it('shows the loading state and an error', async () => {
    const component = await mountSuspended(AddToWishlistButton, {
      props: { inWishlist: false, loading: true, error: 'Wunschliste konnte nicht aktualisiert werden.' },
    })

    expect(component.find('button').attributes('aria-busy') ?? component.find('button').attributes('disabled')).toBeDefined()
    expect(component.find('p.text-error').text()).toBe('Wunschliste konnte nicht aktualisiert werden.')
  })
})
