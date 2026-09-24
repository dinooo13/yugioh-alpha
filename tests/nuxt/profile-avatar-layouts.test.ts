import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { LayoutSidebarContent } from '#components'
import PublicLayout from '~/layouts/public.vue'
import { avatarColorClasses } from '~/utils/avatar'
import type { OwnProfile } from '~~/shared/sharing'
import { setTestLocale } from './fixtures/locale'

type Session = { session: unknown, user: { name: string, email: string } }

const state = vi.hoisted(() => ({
  session: null as Session | null,
  profile: null as OwnProfile | null,
  profileOptions: [] as Array<Record<string, unknown>>,
  execute: undefined as undefined | ((...args: unknown[]) => unknown),
}))

vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve(state.session)),
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string), options: Record<string, unknown> = {}) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/profile') {
      state.profileOptions.push(options)
    }
    return {
      data: ref(resolvedUrl === '/api/profile' ? state.profile : null),
      pending: ref(false),
      error: ref(null),
      refresh: vi.fn(),
      execute: state.execute,
    }
  }
})

function profile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    userId: 'user-a',
    handle: 'fabian',
    displayName: 'Fabian Meyer',
    bio: null,
    inventoryVisibility: 'private',
    wishlistVisibility: 'private',
    locale: null,
    cardLocale: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function signedIn(name = 'Account Name'): Session {
  return { session: { id: 'session-1' }, user: { name, email: 'ygo@example.com' } }
}

afterEach(async () => {
  state.session = null
  state.profile = null
  state.profileOptions = []
  await setTestLocale('de')
})

describe('sidebar navigation', () => {
  const navLabels = (component: { findAll: (selector: string) => { text: () => string }[] }) =>
    component.findAll('nav a').map(link => link.text())

  it('is German by default', async () => {
    state.session = signedIn()
    state.profile = profile()
    state.execute = vi.fn()

    const component = await mountSuspended(LayoutSidebarContent)

    expect(navLabels(component)).toEqual(['Dashboard', 'Inventar', 'Katalog', 'Decks', 'Assistent', 'Formate', 'Wunschliste', 'Turniere'])
    expect(component.text()).toContain('Abmelden')
  })

  it('switches to English', async () => {
    await setTestLocale('en')
    state.session = signedIn()
    state.profile = profile()
    state.execute = vi.fn()

    const component = await mountSuspended(LayoutSidebarContent)

    expect(navLabels(component)).toEqual(['Dashboard', 'Inventory', 'Catalog', 'Decks', 'Assistant', 'Formats', 'Wishlist', 'Tournaments'])
    expect(component.text()).toContain('Profile')
    expect(component.text()).toContain('Sign out')
  })
})

describe('sidebar user block avatar (#50)', () => {
  it('shows the profile\'s display name and its handle-colored avatar', async () => {
    state.session = signedIn()
    state.profile = profile()
    state.execute = vi.fn()

    const component = await mountSuspended(LayoutSidebarContent)

    expect(component.text()).toContain('Fabian Meyer')
    expect(component.text()).not.toContain('Account Name')

    const avatar = component.find(`.${avatarColorClasses('fabian').bg}`)
    expect(avatar.exists()).toBe(true)
    expect(avatar.classes()).toContain('size-8')
    // Decorative: the initials are hidden, the name is the text next to it.
    expect(avatar.find('[aria-hidden="true"]').text()).toBe('FM')
  })

  it('falls back to the account name without a profile', async () => {
    state.session = signedIn('Max Muster')
    state.profile = null
    state.execute = vi.fn()

    const component = await mountSuspended(LayoutSidebarContent)

    expect(component.text()).toContain('Max Muster')
    expect(component.find('[data-slot="fallback"][aria-hidden="true"]').text()).toBe('MM')
  })
})

describe('public layout header avatar (#50)', () => {
  const slots = { default: () => h('p', 'Seiteninhalt') }

  it('shows the profile avatar in "Mein Profil" when signed in', async () => {
    state.session = signedIn()
    state.profile = profile()
    state.execute = vi.fn()

    const component = await mountSuspended(PublicLayout, { slots })
    await flushPromises()

    const link = component.find('a[href="/profile"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('aria-label')).toBe('Mein Profil')
    expect(link.find('[data-slot="fallback"][aria-hidden="true"]').text()).toBe('FM')
    expect(link.find(`.${avatarColorClasses('fabian').bg}`).exists()).toBe(true)
    expect(link.html()).not.toContain('i-lucide:user')
    expect(state.profileOptions.at(-1)?.immediate).toBe(true)
    expect(component.text()).toContain('Seiteninhalt')
  })

  it('neither requests nor shows a profile for anonymous visitors', async () => {
    state.session = null
    state.profile = null
    const execute = vi.fn()
    state.execute = execute

    const component = await mountSuspended(PublicLayout, { slots })
    await flushPromises()

    expect(component.text()).toContain('Anmelden')
    expect(component.find('a[href="/profile"]').exists()).toBe(false)
    expect(component.find('[data-slot="fallback"]').exists()).toBe(false)
    expect(state.profileOptions.at(-1)?.immediate).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it('offers the compact language switch and renders the header in English', async () => {
    await setTestLocale('en')
    state.session = null
    state.profile = null
    state.execute = vi.fn()

    const component = await mountSuspended(PublicLayout, { slots })
    await flushPromises()

    expect(component.find('header button[aria-label="Interface language"]').exists()).toBe(true)
    expect(component.find('header').text()).toContain('Sign in')
  })
})
