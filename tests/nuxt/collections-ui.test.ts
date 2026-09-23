import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CollectionFormModal from '~/components/collections/CollectionFormModal.vue'
import DefaultLayout from '~/layouts/default.vue'

// The sidebar's user block (and with it "Profil"/"Abmelden") only renders
// once a session is present — stub the module directly rather than relying
// on a real `/api/auth/get-session` round trip in the test environment.
vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve({ session: {}, user: { email: 'fabian@example.com', name: 'Fabian Meyer' } })),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('default layout navigation and user block', () => {
  it('lists "Wunschliste" in the nav and keeps a "Profil" button next to "Abmelden"', async () => {
    const component = await mountSuspended(DefaultLayout, { route: '/inventory' })

    expect(component.text()).toContain('Wunschliste')

    const buttons = component.findAll('button, a')
    expect(buttons.some(button => button.text().includes('Profil'))).toBe(true)
    expect(component.findAll('button').some(button => button.text().includes('Abmelden'))).toBe(true)
  })

  it('keeps collections out of the sidebar, even on /inventory (#41)', async () => {
    const component = await mountSuspended(DefaultLayout, { route: '/inventory' })

    // Collection management lives on the inventory page now.
    expect(component.text()).not.toContain('SAMMLUNGEN')
    expect(component.text()).not.toContain('Neue Sammlung')
    expect(component.text()).toContain('Profil')
    expect(component.text()).toContain('Abmelden')
  })
})

describe('collection form modal', () => {
  // UModal teleports its content to <body>, so assertions read the document
  // body rather than the mounted wrapper (which stays empty).
  it('shows a create title when there are no initial values', async () => {
    await mountSuspended(CollectionFormModal, {
      props: { open: true, initialValues: null },
    })

    expect(document.body.textContent).toContain('Neue Sammlung')
  })

  it('shows a rename title and pre-fills the name when editing', async () => {
    await mountSuspended(CollectionFormModal, {
      props: {
        open: true,
        initialValues: { id: 'col-1', name: 'Box 1', description: 'My cards' },
      },
    })

    expect(document.body.textContent).toContain('Sammlung umbenennen')
    expect(document.querySelector('input[name="name"]')).toBeTruthy()
  })

  it('ties the empty-name error to the name field', async () => {
    document.body.innerHTML = ''
    await mountSuspended(CollectionFormModal, {
      props: { open: true, initialValues: null },
    })

    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await nextTick()

    const input = document.querySelector<HTMLInputElement>('input[name="name"]')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby')!.split(' ')
    const messages = describedBy.map(id => document.getElementById(id)?.textContent?.trim())
    expect(messages).toContain('Bitte einen Namen angeben.')
  })

  it('emits the created collection with "saved", so the caller can select it', async () => {
    document.body.innerHTML = ''
    const fetchMock = vi.fn(() => Promise.resolve({ id: 'col-new', name: 'Box 1' }))
    vi.stubGlobal('$fetch', fetchMock)
    const onSaved = vi.fn()

    await mountSuspended(CollectionFormModal, {
      props: { open: true, initialValues: null, onSaved },
    })

    const input = document.querySelector<HTMLInputElement>('input[name="name"]')!
    input.value = 'Box 1'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))

    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: 'col-new', name: 'Box 1' })
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/collections', expect.objectContaining({ method: 'POST' }))
  })
})
