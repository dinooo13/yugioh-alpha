import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import WunschlistePage from '~/pages/wunschliste.vue'
import AddToWishlistButton from '~/components/wishlist/AddToWishlistButton.vue'
import type { WishlistItemView, WishlistResponse } from '~~/shared/sharing'

const state = vi.hoisted(() => ({
  wishlist: { items: [], total: 0, page: 1, pageSize: 24 } as WishlistResponse,
}))

mockNuxtImport('useFetch', () => {
  return () => ({ data: ref(state.wishlist), pending: ref(false), error: ref(null), refresh: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function item(overrides: Partial<WishlistItemView> = {}): WishlistItemView {
  return {
    id: 'wish-1',
    catalogCardId: 1,
    name: 'Kuriboh',
    type: 'Effect Monster',
    imageSmall: null,
    quantity: 1,
    note: null,
    owned: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('wunschliste page', () => {
  it('shows the empty state when there are no items', async () => {
    state.wishlist = { items: [], total: 0, page: 1, pageSize: 24 }

    const component = await mountSuspended(WunschlistePage)

    expect(component.text()).toContain('Noch keine Karten auf der Wunschliste.')
  })

  it('lists wishlist items', async () => {
    state.wishlist = { items: [item()], total: 1, page: 1, pageSize: 24 }

    const component = await mountSuspended(WunschlistePage)

    expect(component.text()).toContain('Kuriboh')
  })

  it('removes a row via DELETE /api/wishlist/:id', async () => {
    state.wishlist = { items: [item()], total: 1, page: 1, pageSize: 24 }
    const fetchMock = vi.fn(() => Promise.resolve(undefined))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(WunschlistePage)
    const removeButton = component.findAll('button').find(btn => btn.text().includes('Entfernen'))
    expect(removeButton).toBeTruthy()

    await removeButton!.trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/api/wishlist/wish-1', { method: 'DELETE' })
  })
})

describe('add to wishlist button', () => {
  it('toggles its label between "Zur Wunschliste" and "Auf der Wunschliste"', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(undefined))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(AddToWishlistButton, {
      props: { catalogCardId: 42, inWishlist: false },
    })

    expect(component.text()).toContain('Zur Wunschliste')

    await component.find('button').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/api/wishlist', { method: 'POST', body: { catalogCardId: 42 } })
    expect(component.emitted('changed')).toEqual([[true]])

    await component.setProps({ inWishlist: true })
    expect(component.text()).toContain('Auf der Wunschliste')

    await component.find('button').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/api/wishlist/card/42', { method: 'DELETE' })
    expect(component.emitted('changed')?.[1]).toEqual([false])
  })
})
