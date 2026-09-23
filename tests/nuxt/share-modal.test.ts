import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ShareModal from '~/components/sharing/ShareModal.vue'
import type { ShareState } from '~~/shared/sharing'

function shareState(overrides: Partial<ShareState> = {}): ShareState {
  return {
    resourceType: 'deck',
    resourceId: 'deck-1',
    visibility: 'private',
    shareToken: null,
    grants: [],
    ...overrides,
  }
}

// UModal teleports its content to <body> (same note as in collections-ui.test.ts),
// so the mounted wrapper itself stays empty — assertions and interactions go
// through `document.body` instead, wrapped so `.trigger()`/`.setValue()` work.
function body() {
  return new DOMWrapper(document.body)
}

async function mountModal(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('$fetch', fetchMock)
  const component = await mountSuspended(ShareModal, {
    props: {
      open: true,
      resourceType: 'deck',
      resourceId: 'deck-1',
      resourceName: 'Test Deck',
      sharePath: '/players/fabian/decks/deck-1',
    },
  })
  // The initial GET is fired reactively from a `watch(..., { immediate: true })`,
  // not from a top-level await — Suspense does not wait for it, so the test
  // must flush the pending promise itself before asserting on the result.
  await flushPromises()
  await component.vm.$nextTick()
  return component
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('sharing share modal', () => {
  it('renders the three visibility options', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(shareState()))
    await mountModal(fetchMock)

    const text = body().text()
    expect(text).toContain('Privat')
    expect(text).toContain('Nur über Link')
    expect(text).toContain('Öffentlich')
  })

  it('describes "Privat" as visible to granted players once a grant exists, singular and plural', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(shareState({
      grants: [{ userId: 'user-b', handle: 'bella', displayName: 'Bella', createdAt: '2025-01-01T00:00:00.000Z' }],
    })))
    await mountModal(fetchMock)

    expect(body().text()).toContain('Nur du und 1 freigegebener Spieler können das sehen.')

    const fetchMockTwo = vi.fn(() => Promise.resolve(shareState({
      grants: [
        { userId: 'user-b', handle: 'bella', displayName: 'Bella', createdAt: '2025-01-01T00:00:00.000Z' },
        { userId: 'user-c', handle: 'carla', displayName: 'Carla', createdAt: '2025-01-01T00:00:00.000Z' },
      ],
    })))
    document.body.innerHTML = ''
    await mountModal(fetchMockTwo)

    expect(body().text()).toContain('Nur du und 2 freigegebene Spieler können das sehen.')
  })

  it('keeps the plain "Privat" description when there are no grants', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(shareState()))
    await mountModal(fetchMock)

    expect(body().text()).toContain('Nur du kannst das sehen.')
  })

  it('hides the token link and dims the grants section once the resource is public', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(shareState({
      visibility: 'public',
      shareToken: 'abc',
      grants: [{ userId: 'user-b', handle: 'bella', displayName: 'Bella', createdAt: '2025-01-01T00:00:00.000Z' }],
    })))
    await mountModal(fetchMock)

    expect(body().find('input[aria-label="Freigabe-Link"]').exists()).toBe(false)
    expect(body().text()).toContain('Nicht nötig – dieses Deck ist für alle sichtbar.')
  })

  it('still shows the token link for "Nur über Link"', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(shareState({ visibility: 'link', shareToken: 'abc' })))
    await mountModal(fetchMock)

    expect(body().find('input[aria-label="Freigabe-Link"]').exists()).toBe(true)
  })

  it('PUTs the new visibility when "Nur über Link" is selected', async () => {
    const fetchMock = vi.fn((url: string, options?: Record<string, unknown>) => {
      if (options?.method === 'PUT') {
        return Promise.resolve(shareState({ visibility: 'link', shareToken: 'abc' }))
      }
      return Promise.resolve(shareState())
    })
    await mountModal(fetchMock)

    const radios = body().findAll('[role="radio"]')
    expect(radios).toHaveLength(3)

    await radios[1]!.trigger('click')
    await flushPromises()

    const putCall = fetchMock.mock.calls.find(([, options]) => (options as Record<string, unknown> | undefined)?.method === 'PUT')
    expect(putCall).toEqual([
      '/api/sharing/deck/deck-1',
      { method: 'PUT', body: { visibility: 'link' } },
    ])
  })

  it('shows a copy button that writes the token URL to the clipboard', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(shareState({ visibility: 'link', shareToken: 'abc' })))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await mountModal(fetchMock)

    const copyButton = body().findAll('button').find(btn => btn.text().includes('Link kopieren'))
    expect(copyButton).toBeTruthy()

    await copyButton!.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/players/fabian/decks/deck-1?token=abc')
  })

  it('lists a granted user by display name and handle (never an email) and removes it', async () => {
    const fetchMock = vi.fn((url: string, options?: Record<string, unknown>) => {
      if (options?.method === 'DELETE') {
        return Promise.resolve(shareState())
      }
      return Promise.resolve(shareState({
        grants: [{ userId: 'user-b', handle: 'bella', displayName: 'Bella', createdAt: '2025-01-01T00:00:00.000Z' }],
      }))
    })
    await mountModal(fetchMock)

    const text = body().text()
    expect(text).toContain('Bella')
    expect(text).toContain('@bella')
    // No email address (name@domain.tld) ever appears in the rendered grant row.
    expect(text).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/)

    const removeButton = body().findAll('button').find(btn => btn.text().includes('Entfernen'))
    expect(removeButton).toBeTruthy()

    await removeButton!.trigger('click')
    await flushPromises()

    const deleteCall = fetchMock.mock.calls.find(([, options]) => (options as Record<string, unknown> | undefined)?.method === 'DELETE')
    expect(deleteCall?.[0]).toBe('/api/sharing/deck/deck-1/grants/user-b')
  })

  it('the user picker only searches the API from 2 characters on', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/users/search') {
        return Promise.resolve({ items: [{ userId: 'user-c', handle: 'carla', displayName: 'Carla' }] })
      }
      return Promise.resolve(shareState())
    })
    await mountModal(fetchMock)

    const input = body().find('input[aria-label="Spieler suchen"]')

    await input.setValue('a')
    await new Promise(resolve => setTimeout(resolve, 350))

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/users/search')).toBe(false)

    await input.setValue('ab')
    await new Promise(resolve => setTimeout(resolve, 350))

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/users/search')).toBe(true)
  })
})
