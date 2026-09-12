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

  it('shows the handle rule, a live URL preview and moves the profile link into the same card as the form', async () => {
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(state.profile)))

    const component = await mountSuspended(ProfilPage)
    const text = component.text()

    expect(text).toContain('Nur Kleinbuchstaben, Ziffern und Bindestriche, 3–30 Zeichen')
    expect(text).toContain('/spieler/fabian')

    const form = component.find('form')
    const profileLink = component.find('a[href="/spieler/fabian"]')
    expect(form.exists()).toBe(true)
    expect(profileLink.exists()).toBe(true)
    // Both the form and the public-profile link live in the same card now
    // (UX review #23) — the link's closest bordered card ancestor is the
    // form's own parent, not a separate section further down the page.
    expect(profileLink.element.closest('.rounded-md')).toBe(form.element.closest('.rounded-md'))
  })

  it('warns that old shared links break once the handle is actually changed', async () => {
    state.profile = profile({ handle: 'fabian' })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(profile({ handle: 'fabian-neu' }))))

    const component = await mountSuspended(ProfilPage)
    await component.find('input[aria-label="Nutzername"]').setValue('fabian-neu')
    await component.find('form').trigger('submit')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Bereits geteilte Links mit dem alten Nutzernamen funktionieren nicht mehr.')
  })

  it('does not warn about broken links when the handle stays the same', async () => {
    state.profile = profile({ handle: 'fabian' })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(profile({ handle: 'fabian' }))))

    const component = await mountSuspended(ProfilPage)
    await component.find('form').trigger('submit')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).not.toContain('Bereits geteilte Links mit dem alten Nutzernamen funktionieren nicht mehr.')
  })

  it('shows the same "Gespeichert" feedback for the wishlist toggle as for the form', async () => {
    state.profile = profile({ wishlistVisibility: 'private' })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(profile({ wishlistVisibility: 'public' }))))

    const component = await mountSuspended(ProfilPage)
    const toggle = component.find('button[aria-label="Wunschliste öffentlich zeigen"]')
    expect(toggle.exists()).toBe(true)

    await toggle.trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Gespeichert')
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
