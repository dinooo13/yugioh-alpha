import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import ProfilPage from '~/pages/profil.vue'
import type { OwnProfile } from '~~/shared/sharing'

function profile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    userId: 'user-a',
    handle: 'fabian',
    displayName: 'Fabian',
    bio: null,
    inventoryVisibility: 'private',
    wishlistVisibility: 'private',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const state = vi.hoisted(() => ({ profile: {} as OwnProfile }))

mockNuxtImport('useFetch', () => {
  return () => ({ data: ref(state.profile), pending: ref(false), error: ref(null), refresh: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('profil page', () => {
  it('renders the profile fields, the public profile link, the sharing panel and the wishlist toggle', async () => {
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(state.profile)))

    const component = await mountSuspended(ProfilPage)
    const text = component.text()

    expect(text).toContain('Anzeigename')
    expect(text).toContain('Nutzername')
    expect(text).toContain('Über mich')
    expect(component.find('a[href="/spieler/fabian"]').exists()).toBe(true)
    expect(text).toContain('Inventar teilen')
    expect(text).toContain('Wunschliste öffentlich zeigen')
  })

  it('surfaces the German conflict message on a 409 from the save request', async () => {
    state.profile = profile()
    const conflict = Object.assign(new Error('Conflict'), {
      data: { statusCode: 409, statusMessage: 'A player with this handle already exists' },
    })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.reject(conflict)))

    const component = await mountSuspended(ProfilPage)
    await component.find('form').trigger('submit')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Es gibt bereits einen Spieler mit diesem Nutzernamen.')
  })
})
