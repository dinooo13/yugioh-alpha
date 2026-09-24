import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ULocaleSelect, USelect } from '#components'
import ProfilePage from '~/pages/profile.vue'
import type { OwnProfile } from '~~/shared/sharing'
import { setTestLocale } from './fixtures/locale'

function profile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    userId: 'user-a',
    handle: 'fabian',
    displayName: 'Fabian',
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

const state = vi.hoisted(() => ({ profile: {} as OwnProfile }))

mockNuxtImport('useFetch', () => {
  return () => ({ data: ref(state.profile), pending: ref(false), error: ref(null), refresh: vi.fn() })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  useNuxtData('own-profile').data.value = undefined
  useState('card-locale-choice').value = null
  document.cookie = 'ui_locale=; Max-Age=0; path=/'
  await setTestLocale('de')
})

describe('profile page', () => {
  it('renders the profile fields, the public profile link, the sharing panel and the wishlist toggle', async () => {
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(state.profile)))

    const component = await mountSuspended(ProfilePage)
    const text = component.text()

    expect(text).toContain('Anzeigename')
    expect(text).toContain('Nutzername')
    expect(text).toContain('Über mich')
    expect(component.find('a[href="/players/fabian"]').exists()).toBe(true)
    expect(text).toContain('Inventar teilen')
    expect(text).toContain('Wunschliste öffentlich zeigen')
  })

  it('shows the handle rule, a live URL preview and moves the profile link into the same card as the form', async () => {
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(state.profile)))

    const component = await mountSuspended(ProfilePage)
    const text = component.text()

    expect(text).toContain('Nur Kleinbuchstaben, Ziffern und Bindestriche, 3–30 Zeichen')
    expect(text).toContain('/players/fabian')

    const form = component.find('form')
    const profileLink = component.find('a[href="/players/fabian"]')
    expect(form.exists()).toBe(true)
    expect(profileLink.exists()).toBe(true)
    // Both the form and the public-profile link live in the same card now
    // (UX review #23) — the link's closest bordered card ancestor is the
    // form's own parent, not a separate section further down the page.
    expect(profileLink.element.closest('.panel')).toBe(form.element.closest('.panel'))
  })

  it('warns that old shared links break once the handle is actually changed', async () => {
    state.profile = profile({ handle: 'fabian' })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(profile({ handle: 'fabian-neu' }))))

    const component = await mountSuspended(ProfilePage)
    await component.find('input[aria-label="Nutzername"]').setValue('fabian-neu')
    await component.find('form').trigger('submit')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Bereits geteilte Links mit dem alten Nutzernamen funktionieren nicht mehr.')
  })

  it('does not warn about broken links when the handle stays the same', async () => {
    state.profile = profile({ handle: 'fabian' })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(profile({ handle: 'fabian' }))))

    const component = await mountSuspended(ProfilePage)
    await component.find('form').trigger('submit')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).not.toContain('Bereits geteilte Links mit dem alten Nutzernamen funktionieren nicht mehr.')
  })

  it('shows the same "Gespeichert" feedback for the wishlist toggle as for the form', async () => {
    state.profile = profile({ wishlistVisibility: 'private' })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(profile({ wishlistVisibility: 'public' }))))

    const component = await mountSuspended(ProfilePage)
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

    const component = await mountSuspended(ProfilePage)
    await component.find('form').trigger('submit')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Es gibt bereits einen Spieler mit diesem Nutzernamen.')
  })

  it('shows a coded server error in German instead of the raw statusMessage', async () => {
    state.profile = profile()
    const rejected = Object.assign(new Error('Bad Request'), {
      data: { statusCode: 400, statusMessage: 'bio must be at most 500 characters', data: { code: 'bio_too_long' } },
    })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.reject(rejected)))

    const component = await mountSuspended(ProfilePage)
    await component.find('form').trigger('submit')
    await flushPromises()

    expect(component.text()).toContain('Der Text „Über mich“ darf höchstens 500 Zeichen lang sein.')
    expect(component.text()).not.toContain('bio must be at most')
  })

  it('shows the settings card with the interface language switch', async () => {
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(state.profile)))

    const component = await mountSuspended(ProfilePage)

    expect(component.find('#settings h2').text()).toBe('Einstellungen')
    expect(component.find('#settings').text()).toContain('Anzeigesprache')
    expect(component.find('#settings button[aria-label="Anzeigesprache"]').text()).toContain('Deutsch')
  })

  it('renders the profile and settings card in English', async () => {
    await setTestLocale('en')
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(state.profile)))

    const component = await mountSuspended(ProfilePage)
    const text = component.text()

    expect(component.find('h1').text()).toBe('Profile')
    expect(text).toContain('Display name')
    expect(text).toContain('Show wishlist publicly')
    expect(component.find('#settings h2').text()).toBe('Settings')
    expect(component.find('#settings').text()).toContain('Interface language')
    expect(component.find('#settings button[aria-label="Interface language"]').text()).toContain('English')
  })

  it('saves a new interface language to the profile, sets the cookie and switches the UI', async () => {
    state.profile = profile()
    useNuxtData('own-profile').data.value = profile()
    const fetchMock = vi.fn(() => Promise.resolve(profile({ locale: 'en' })))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(ProfilePage)
    component.findComponent(ULocaleSelect).vm.$emit('update:modelValue', 'en')
    await flushPromises()
    await component.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/api/profile', { method: 'PATCH', body: { locale: 'en' } })
    expect(document.cookie).toContain('ui_locale=en')
    expect(useNuxtApp().$i18n.locale.value).toBe('en')
    expect(component.find('h1').text()).toBe('Profile')
    expect(component.find('#settings').text()).toContain('Saved')
  })

  it('keeps the language and shows a toast when saving it fails', async () => {
    state.profile = profile()
    useNuxtData('own-profile').data.value = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const component = await mountSuspended(ProfilePage)
    component.findComponent(ULocaleSelect).vm.$emit('update:modelValue', 'en')
    await flushPromises()

    expect(useNuxtApp().$i18n.locale.value).toBe('de')
    expect(document.cookie).not.toContain('ui_locale=en')
    expect(component.find('h1').text()).toBe('Profil')
    expect(useToast().toasts.value.map(toast => toast.title)).toContain('Sprache konnte nicht gespeichert werden')
  })

  interface SelectWrapper {
    props: () => { id?: string, modelValue?: string, items?: Array<{ label: string, value: string }> }
    vm: { $emit: (event: string, value: string) => void }
  }

  function cardLocaleSelect(component: VueWrapper): SelectWrapper {
    const selects = component.findAllComponents(USelect) as unknown as SelectWrapper[]
    return selects.find(select => select.props().id === 'profile-card-locale')!
  }

  it('shows the card language setting, following the interface language by default', async () => {
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(state.profile)))

    const component = await mountSuspended(ProfilePage)
    const settings = component.find('#settings').text()

    expect(settings).toContain('Kartensprache')
    expect(settings).toContain('Die Sprache von Kartennamen und Kartentexten. Kartenbilder bleiben englisch.')
    const select = cardLocaleSelect(component)
    expect(select.props().modelValue).toBe('follow')
    expect(select.props().items!.map(item => item.label))
      .toEqual(['Wie Anzeigesprache (Deutsch)', 'Deutsch', 'Englisch'])
  })

  it('names the follow option after the interface language in English', async () => {
    await setTestLocale('en')
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(state.profile)))

    const component = await mountSuspended(ProfilePage)
    const select = cardLocaleSelect(component)
    expect(component.find('#settings').text()).toContain('Card language')
    expect(select.props().items!.map(item => item.label))
      .toEqual(['Same as interface (English)', 'German', 'English'])
  })

  it('saves the card language to the profile and switches the card names at once', async () => {
    state.profile = profile()
    useNuxtData('own-profile').data.value = profile()
    const fetchMock = vi.fn(() => Promise.resolve(profile({ cardLocale: 'en' })))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(ProfilePage)
    cardLocaleSelect(component).vm.$emit('update:modelValue', 'en')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/profile', { method: 'PATCH', body: { cardLocale: 'en' } })
    expect(useState('card-locale-choice').value).toBe('en')
    expect(useNuxtData<OwnProfile>('own-profile').data.value?.cardLocale).toBe('en')
    // The interface language stays.
    expect(useNuxtApp().$i18n.locale.value).toBe('de')
    expect(component.find('#settings').text()).toContain('Gespeichert')

    // "Follow" resets it to null.
    fetchMock.mockClear()
    cardLocaleSelect(component).vm.$emit('update:modelValue', 'follow')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/profile', { method: 'PATCH', body: { cardLocale: null } })
    expect(useState('card-locale-choice').value).toBeNull()
  })

  it('keeps the card language and shows a toast when saving it fails', async () => {
    state.profile = profile()
    vi.stubGlobal('$fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const component = await mountSuspended(ProfilePage)
    cardLocaleSelect(component).vm.$emit('update:modelValue', 'de')
    await flushPromises()

    expect(useState('card-locale-choice').value).toBeNull()
    expect(useToast().toasts.value.map(toast => toast.title)).toContain('Kartensprache konnte nicht gespeichert werden')
  })
})
