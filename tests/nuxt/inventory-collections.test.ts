import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount } from '@vue/test-utils'
import { defineComponent, nextTick, toValue } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { UDropdownMenu } from '#components'
import InventoryPage from '~/pages/inventory/index.vue'
import AddToInventoryModal from '~/components/inventory/AddToInventoryModal.vue'
import CollectionActions from '~/components/collections/CollectionActions.vue'
import ConfirmDialog from '~/components/layout/ConfirmDialog.vue'

// Collection management on /inventory (#41): the URL (`?collectionId=`) is the
// single source of truth, so these tests mount the page on a real route and
// read the router back instead of mocking `useRoute`.

// The global auth middleware would bounce `route: '/inventory?…'` to /login
// without a session — stub it so the page sees its own query.
vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve({ session: {}, user: { email: 'fabian@example.com', name: 'Fabian Meyer' } })),
}))

// `useConfirm()` only settles with `ConfirmDialog` mounted alongside (it
// normally lives in the default layout — see formats-page.test.ts).
const PageWithConfirmDialog = defineComponent({
  components: { InventoryPage, ConfirmDialog },
  template: '<div><InventoryPage /><ConfirmDialog /></div>',
})

// UModal teleports its content to <body>.
function body() {
  return new DOMWrapper(document.body)
}

interface CollectionItem {
  id: string
  name: string
  description: string | null
  cardCount: number
  visibility: 'private' | 'link' | 'public'
}

function initialCollections() {
  return {
    items: [
      { id: 'col-1', name: 'Box 1', description: null, cardCount: 3, visibility: 'public' },
      { id: 'col-2', name: 'Binder', description: null, cardCount: 2, visibility: 'private' },
    ] as CollectionItem[],
    // 7 copies in total → 2 without a collection.
    allCount: 7,
  }
}

const state = vi.hoisted(() => ({
  collections: { items: [] as CollectionItem[], allCount: 0 },
  calls: [] as Array<{ url: string, opts?: { query?: unknown } }>,
}))

mockNuxtImport('useFetch', () => {
  return (url: string, opts?: { query?: unknown }) => {
    state.calls.push({ url, opts })
    if (url === '/api/collections') {
      const data = ref(state.collections)
      // Like the real refresh: reloads whatever the "server" has now.
      const refresh = vi.fn(async () => {
        data.value = state.collections
      })
      return { data, pending: ref(false), status: ref('success'), refresh }
    }
    if (url === '/api/profile') {
      return { data: ref({ userId: 'user-1', handle: 'fabian', displayName: 'Fabian' }), pending: ref(false), refresh: vi.fn() }
    }
    if (url === '/api/inventory/search') {
      return { data: ref({ items: [], total: 0, page: 1, pageSize: 24 }), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (url === '/api/inventory/search/facets') {
      return { data: ref(null), pending: ref(false), refresh: vi.fn() }
    }
    return { data: ref({ items: [], total: 0 }), pending: ref(false), refresh: vi.fn() }
  }
})

function lastQuery(url: string): Record<string, unknown> {
  const call = state.calls.filter(c => c.url === url).at(-1)
  return toValue(call?.opts?.query as Record<string, unknown>)
}

const fetchMock = vi.fn((url: string, options?: { method?: string, body?: { name?: string } }) => {
  if (url === '/api/collections' && options?.method === 'POST') {
    const created: CollectionItem = { id: 'col-new', name: options.body?.name ?? '', description: null, cardCount: 0, visibility: 'private' }
    state.collections = { ...state.collections, items: [...state.collections.items, created] }
    return Promise.resolve(created)
  }
  if (url.startsWith('/api/collections/') && options?.method === 'DELETE') {
    state.collections = { ...state.collections, items: state.collections.items.filter(c => `/api/collections/${c.id}` !== url) }
    return Promise.resolve(null)
  }
  if (url.startsWith('/api/sharing/')) {
    return Promise.resolve({ resourceType: 'collection', resourceId: 'col-1', visibility: 'public', shareToken: null, grants: [] })
  }
  return Promise.resolve(null)
})

beforeEach(() => {
  state.collections = initialCollections()
  state.calls = []
  fetchMock.mockClear()
  vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

// Every test shares one router: a page left mounted from an earlier test
// would re-render on the next test's navigation (with its DOM already gone)
// and abort that render. Registered last, so it runs before the cleanup above.
enableAutoUnmount(afterEach)

function currentQuery() {
  return useRouter().currentRoute.value.query
}

function menuItem(component: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  const groups = component.findComponent(UDropdownMenu).props('items') as Array<Array<{ label: string, onSelect: () => void }>>
  const item = groups[0]!.find(entry => entry.label === label)
  expect(item).toBeTruthy()
  return item!
}

describe('inventory collection scope from the URL', () => {
  it('scopes header, both views and the presets to ?collectionId=', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory?collectionId=col-1' })

    expect(component.find('h1').text()).toBe('Box 1')
    expect(component.text()).toContain('3 Karten')
    expect(component.text()).toContain('Öffentlich')
    expect(component.find('[aria-label="Optionen für Box 1"]').exists()).toBe(true)

    expect(lastQuery('/api/inventory')).toMatchObject({ collectionId: 'col-1' })
    expect(lastQuery('/api/inventory/search')).toMatchObject({ collectionId: 'col-1' })

    const quickEntry = component.findAll('a').find(link => link.text().includes('Schnellerfassung'))
    expect(quickEntry!.attributes('href')).toBe('/inventory/quick-entry?collectionId=col-1')
    expect(component.findComponent(AddToInventoryModal).props('presetCollectionId')).toBe('col-1')
  })

  it('shows the cards without a collection for ?collectionId=__none__', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory?collectionId=__none__' })

    expect(component.find('h1').text()).toBe('Ohne Sammlung')
    expect(component.text()).toContain('2 Karten')
    expect(component.text()).toContain('Keine Karten ohne Sammlung')
    expect(component.find('[aria-label^="Optionen für"]').exists()).toBe(false)

    expect(lastQuery('/api/inventory')).toMatchObject({ collectionId: '__none__' })
    expect(lastQuery('/api/inventory/search')).toMatchObject({ collectionId: '__none__' })

    // Neither preset can take "no collection" as a collection id.
    const quickEntry = component.findAll('a').find(link => link.text().includes('Schnellerfassung'))
    expect(quickEntry!.attributes('href')).toBe('/inventory/quick-entry')
    expect(component.findComponent(AddToInventoryModal).props('presetCollectionId')).toBeNull()
  })

  it('writes a selected collection to the URL, and every consumer follows', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    expect(component.find('h1').text()).toBe('Alle Karten')
    expect(component.text()).toContain('7 Karten')

    component.findComponent(CollectionActions).vm.$emit('update:modelValue', 'col-2')

    await vi.waitFor(() => {
      expect(currentQuery()).toEqual({ collectionId: 'col-2' })
    })
    await vi.waitFor(() => {
      expect(component.find('h1').text()).toBe('Binder')
    })
    expect(lastQuery('/api/inventory')).toMatchObject({ collectionId: 'col-2' })
    expect(lastQuery('/api/inventory/search')).toMatchObject({ collectionId: 'col-2' })

    // Back to all cards: the default is never written to the URL.
    component.findComponent(CollectionActions).vm.$emit('update:modelValue', '')
    await vi.waitFor(() => {
      expect(currentQuery()).toEqual({})
    })
  })

  it('drops an unknown ?collectionId= once the collections are loaded', async () => {
    await mountSuspended(InventoryPage, { route: '/inventory?collectionId=gone&view=overview' })

    // The former `view=overview` is rewritten to `gallery` too (#135).
    await vi.waitFor(() => {
      expect(currentQuery()).toEqual({ view: 'gallery' })
    })
  })
})

describe('inventory collection management', () => {
  it('creates a collection via "Neue Sammlung" and selects it', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory' })

    await component.findAll('button').find(btn => btn.text() === 'Neue Sammlung')!.trigger('click')
    await vi.waitFor(() => {
      expect(document.querySelector('input[name="name"]')).toBeTruthy()
    })

    const input = document.querySelector<HTMLInputElement>('input[name="name"]')!
    input.value = 'Box 3'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))

    await vi.waitFor(() => {
      expect(currentQuery()).toEqual({ collectionId: 'col-new' })
    })
    await vi.waitFor(() => {
      expect(component.find('h1').text()).toBe('Box 3')
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/collections', expect.objectContaining({ method: 'POST' }))
  })

  it('opens the rename dialog pre-filled from "Umbenennen"', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory?collectionId=col-1' })

    menuItem(component, 'Umbenennen').onSelect()

    await vi.waitFor(() => {
      expect(body().text()).toContain('Sammlung umbenennen')
    })
    expect(document.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('Box 1')
  })

  it('opens the collection share dialog from "Teilen"', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory?collectionId=col-1' })

    const share = menuItem(component, 'Teilen') as { onSelect: () => void, disabled?: boolean }
    expect(share.disabled).toBe(false)
    share.onSelect()

    await vi.waitFor(() => {
      expect(body().text()).toContain('Sammlung teilen')
    })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sharing/collection/col-1')
    })
  })

  it('deletes the active collection after a confirmation and falls back to all cards', async () => {
    const component = await mountSuspended(PageWithConfirmDialog, { route: '/inventory?collectionId=col-1' })

    menuItem(component, 'Löschen').onSelect()
    await vi.waitFor(() => {
      expect(body().text()).toContain('"Box 1" löschen?')
    })
    await body().findAll('button').find(btn => btn.text() === 'Bestätigen')!.trigger('click')

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/collections/col-1', { method: 'DELETE' })
    })
    await vi.waitFor(() => {
      expect(currentQuery()).toEqual({})
    })
    await vi.waitFor(() => {
      expect(component.find('h1').text()).toBe('Alle Karten')
    })
  })
})
