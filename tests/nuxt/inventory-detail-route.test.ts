import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount } from '@vue/test-utils'
import { nextTick, toValue } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CardDetailModal from '~/components/card/CardDetailModal.vue'
import InventorySearchPanel from '~/components/inventory/InventorySearchPanel.vue'
import InventoryPage from '~/pages/inventory/index.vue'

// The inventory's detail panel follows `?card=` (#145), and "Liste" takes
// the search panel's filters.

// The global auth middleware would bounce `route: '/inventory?…'` to /login
// without a session — stub it so the page sees its own query (and a route
// push from a row doesn't wait on a stubbed `$fetch`).
vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve({ session: {}, user: { email: 'fabian@example.com', name: 'Fabian Meyer' } })),
}))

// UModal teleports its content to <body>.
function body() {
  return new DOMWrapper(document.body)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

// All tests share one router — unmount each page so an earlier one doesn't
// re-render on a later test's navigation (runs before the cleanup above).
enableAutoUnmount(afterEach)

const BLUE_EYES = 89631139

// The overlay loads the card from the catalog, its editor the card's rows.
function stubOverlayFetch() {
  vi.stubGlobal('$fetch', vi.fn((url: string) => {
    if (url === `/api/catalog/cards/${BLUE_EYES}`) {
      return Promise.resolve({
        card: {
          id: BLUE_EYES,
          name: 'Blue-Eyes White Dragon',
          nameDe: null,
          type: 'Normal Monster',
          frameType: 'normal',
          desc: 'This legendary dragon is a powerful engine of destruction.',
          descDe: null,
          race: 'Dragon',
          archetype: null,
          attribute: 'LIGHT',
          atk: 3000,
          def: 2500,
          level: 8,
          linkval: null,
          scale: null,
          linkMarkers: null,
          banlistInfo: null,
          cardPrices: null,
          tcgDate: null,
          ocgDate: null,
          ygoprodeckUrl: null,
        },
        printings: [],
        images: [],
      })
    }
    if (url === '/api/inventory') {
      return Promise.resolve({ items: [{ id: 'row-1', collectionId: null, quantity: 3, note: null }], total: 1 })
    }
    return Promise.reject(new Error(`unexpected ${url}`))
  }))
}

const listRow = {
  id: 'row-1',
  catalogCardId: BLUE_EYES,
  collectionId: null,
  quantity: 3,
  note: null,
  cardName: 'Blue-Eyes White Dragon',
  cardNameDe: null,
  cardType: 'Normal Monster',
  cardAttribute: 'LIGHT',
  cardTextExcerpt: null,
  cardTextExcerptDe: null,
  imageUrlSmall: null,
}

const facets = {
  types: ['Normal Monster', 'Spell Card'],
  attributes: ['LIGHT'],
  races: ['Dragon'],
  levels: [8],
}

const state = vi.hoisted(() => ({
  inventory: { items: [] as Array<Record<string, unknown>>, total: 0 },
  // Every `useFetch(url, opts)` call, so tests can read the reactive query.
  calls: [] as Array<{ url: string, opts?: { query?: unknown } }>,
}))

mockNuxtImport('useFetch', () => {
  return (url: string, opts?: { query?: unknown }) => {
    state.calls.push({ url, opts })
    if (url === '/api/inventory/search') {
      return { data: ref({ items: [], total: 0, page: 1, pageSize: 24 }), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (url === '/api/inventory/search/facets') {
      return { data: ref(facets), pending: ref(false), refresh: vi.fn() }
    }
    if (url === '/api/collections') {
      return { data: ref({ items: [], allCount: 3 }), pending: ref(false), status: ref('success'), refresh: vi.fn() }
    }
    return { data: ref(state.inventory), pending: ref(false), refresh: vi.fn() }
  }
})

function lastQuery(url: string): Record<string, unknown> {
  const call = state.calls.filter(c => c.url === url).at(-1)
  return toValue(call?.opts?.query as Record<string, unknown>)
}

describe('the detail panel in the URL (#145)', () => {
  it('opens from ?card= and drops the param when it closes', async () => {
    state.inventory = { items: [listRow], total: 1 }
    stubOverlayFetch()

    const component = await mountSuspended(InventoryPage, { route: `/inventory?card=${BLUE_EYES}` })
    const route = useRouter().currentRoute

    await vi.waitFor(() => {
      expect(body().find('[role="dialog"]').exists()).toBe(true)
      expect(body().find('[aria-label="Anzahl in (keine Sammlung)"]').exists()).toBe(true)
    })
    // The card is on the page: its row is the preview.
    expect(body().find('[role="dialog"]').text()).toContain('Blue-Eyes White Dragon')
    // Not opened from a row: none is singled out.
    expect(body().find('[data-focused]').exists()).toBe(false)

    component.findComponent(CardDetailModal).vm.$emit('update:open', false)
    await vi.waitFor(() => {
      expect(route.value.query).toEqual({})
    })
  })

  it('drops an invalid ?card=', async () => {
    state.inventory = { items: [listRow], total: 1 }

    await mountSuspended(InventoryPage, { route: '/inventory?card=abc&view=gallery' })
    const route = useRouter().currentRoute

    await vi.waitFor(() => {
      expect(route.value.query).toEqual({ view: 'gallery' })
    })
    expect(body().find('[role="dialog"]').exists()).toBe(false)
  })

  it('writes ?card= from a "Liste" row and highlights that row', async () => {
    state.inventory = { items: [listRow], total: 1 }
    stubOverlayFetch()

    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    const route = useRouter().currentRoute

    await component.findAll('li button').find(button => button.text() === 'Blue-Eyes White Dragon')!.trigger('click')

    await vi.waitFor(() => {
      expect(route.value.query).toEqual({ card: String(BLUE_EYES) })
      expect(body().find('[aria-label="Anzahl in (keine Sammlung)"]').exists()).toBe(true)
    })
    const dialog = body().find('[role="dialog"]')
    expect(dialog.text()).toContain('Im Inventar')
    expect(dialog.find('[data-row-id="row-1"]').attributes('data-focused')).toBe('')
    expect(dialog.find<HTMLInputElement>('[aria-label="Anzahl in (keine Sammlung)"]').element.value).toBe('3')
  })
})

describe('filters in "Liste" (#145)', () => {
  it('sends the facets and "Auch im Kartentext suchen" to the list, and stays in "Liste"', async () => {
    state.inventory = { items: [listRow], total: 1 }
    state.calls = []

    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    const route = useRouter().currentRoute
    const panel = component.findComponent(InventorySearchPanel)
    const filters = panel.props('filters') as { type: string[], level: number[] }

    panel.vm.$emit('update:filters', { ...filters, type: ['Spell Card'], level: [4, 7] })
    await nextTick()
    await component.find('[role="checkbox"]').trigger('click')
    await nextTick()

    expect(lastQuery('/api/inventory')).toMatchObject({ type: 'Spell Card', level: '4,7', inText: 1, page: 1 })
    // No "only in Galerie" hint, and no switch to "Galerie".
    expect(component.text()).not.toContain('nur in "Galerie"')
    expect(route.value.query.view).toBeUndefined()
    const listToggle = component.findAll('button').find(btn => btn.text() === 'Liste')!
    expect(listToggle.attributes('aria-pressed')).toBe('true')
  })

  it('shows the sort only in "Galerie"', async () => {
    state.inventory = { items: [listRow], total: 1 }

    const list = await mountSuspended(InventoryPage, { route: '/inventory' })
    expect(list.text()).not.toContain('Sortierung')
    expect(list.findComponent(InventorySearchPanel).props('showSort')).toBe(false)
    list.unmount()

    const gallery = await mountSuspended(InventoryPage, { route: '/inventory?view=gallery' })
    expect(gallery.text()).toContain('Sortierung')
  })
})
