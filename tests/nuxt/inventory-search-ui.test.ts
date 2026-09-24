import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount } from '@vue/test-utils'
import { nextTick, toValue } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import InventoryPage from '~/pages/inventory/index.vue'

// The global auth middleware would bounce `route: '/inventory?…'` to /login
// without a session — stub it so the page sees its own query.
vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve({ session: {}, user: { email: 'fabian@example.com', name: 'Fabian Meyer' } })),
}))

// UModal teleports its content to <body> (same note as in catalog-page.test.ts).
function body() {
  return new DOMWrapper(document.body)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

// The card detail overlay (#88) loads the card from the catalog and the
// per-collection notes from the inventory.
function stubOverlayFetch() {
  vi.stubGlobal('$fetch', vi.fn((url: string) => {
    if (url === '/api/catalog/cards/89631139') {
      return Promise.resolve({
        card: {
          id: 89631139,
          name: 'Blue-Eyes White Dragon',
          nameDe: null,
          type: 'Normal Monster',
          frameType: 'normal',
          desc: 'This legendary dragon is a powerful engine of destruction.',
          descDe: 'Dieser legendäre Drache ist eine mächtige Zerstörungsmaschine.',
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
          tcgDate: '2002-03-08',
          ocgDate: null,
          ygoprodeckUrl: null,
        },
        printings: [{ setCode: 'LOB-001', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: null }],
        images: [],
      })
    }
    if (url === '/api/inventory') {
      return Promise.resolve({ items: [{ collectionId: 'box-1', quantity: 3, note: 'Oben links' }], total: 1 })
    }
    return Promise.reject(new Error(`unexpected ${url}`))
  }))
}

// All tests share one router — unmount each page so an earlier one doesn't
// re-render on a later test's navigation (runs before the cleanup above).
enableAutoUnmount(afterEach)

interface SearchCollectionBreakdown {
  collectionId: string | null
  collectionName: string | null
  quantity: number
}

interface SearchResultItem {
  catalogCardId: number
  name: string
  type: string
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  imageLarge: string | null
  totalQuantity: number
  collectionBreakdown?: SearchCollectionBreakdown[]
}

const emptyFacets = {
  types: [] as string[],
  attributes: [] as string[],
  races: [] as string[],
  levels: [] as number[],
}

const state = vi.hoisted(() => ({
  inventory: { items: [] as Array<Record<string, unknown>>, total: 0 },
  search: { items: [] as SearchResultItem[], total: 0, page: 1, pageSize: 24 },
  facets: {
    types: [] as string[],
    attributes: [] as string[],
    races: [] as string[],
    levels: [] as number[],
  },
  searchPending: false,
  // Every `useFetch(url, opts)` call, so tests can read the reactive query.
  calls: [] as Array<{ url: string, opts?: { query?: unknown } }>,
}))

mockNuxtImport('useFetch', () => {
  return (url: string, opts?: { query?: unknown }) => {
    state.calls.push({ url, opts })
    if (url === '/api/inventory/search') {
      return { data: ref(state.search), pending: ref(state.searchPending), error: ref(null), refresh: vi.fn() }
    }
    if (url === '/api/inventory/search/facets') {
      return { data: ref(state.facets), pending: ref(false), refresh: vi.fn() }
    }
    return { data: ref(state.inventory), pending: ref(false), refresh: vi.fn() }
  }
})

function lastQuery(url: string): Record<string, unknown> {
  const call = state.calls.filter(c => c.url === url).at(-1)
  return toValue(call?.opts?.query as Record<string, unknown>)
}

async function openUebersicht(component: Awaited<ReturnType<typeof mountSuspended>>) {
  const toggle = component.findAll('button').find((btn: { text: () => string }) => btn.text().includes('Übersicht'))
  expect(toggle).toBeTruthy()
  await toggle!.trigger('click')
  const route = useRouter().currentRoute
  await vi.waitFor(() => {
    expect(route.value.query.view).toBe('overview')
  })
  await nextTick()
}

describe('inventory search panel (Übersicht)', () => {
  it('renders filter controls, total quantity, and the per-collection breakdown', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = {
      ...emptyFacets,
      types: ['Normal Monster'],
      attributes: ['LIGHT'],
      races: ['Dragon'],
    }
    state.search = {
      items: [
        {
          catalogCardId: 89631139,
          name: 'Blue-Eyes White Dragon',
          type: 'Normal Monster',
          attribute: 'LIGHT',
          race: 'Dragon',
          level: 8,
          atk: 3000,
          def: 2500,
          imageSmall: 'https://images.example/bewd-small.jpg',
          imageLarge: 'https://images.example/bewd.jpg',
          totalQuantity: 5,
          collectionBreakdown: [
            { collectionId: 'box-1', collectionName: 'Box 1', quantity: 3 },
            { collectionId: null, collectionName: null, quantity: 2 },
          ],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 24,
    }

    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    await openUebersicht(component)

    const text = component.text()

    // Filter panel controls (catalog facets, sort, reset). No set or
    // ownership filters since ADR 0017.
    expect(component.find('[aria-label="Typ"]').exists()).toBe(true)
    expect(component.find('[aria-label="Monsterart"]').exists()).toBe(true)
    expect(text).toContain('Sortierung')
    expect(text).toContain('Reset')
    expect(text).not.toContain('Besitz')
    expect(component.find('[aria-label="Set"]').exists()).toBe(false)
    expect(component.find('[aria-label="Drucksprache"]').exists()).toBe(false)
    expect(component.find('[aria-label="Zustand"]').exists()).toBe(false)

    // Aggregated result: name, total quantity, and per-collection breakdown.
    expect(text).toContain('Blue-Eyes White Dragon')
    expect(text).toContain('1 Karte')
    expect(text).toContain('×5 ges.')
    expect(text).toContain('Box 1 ×3')
    expect(text).toContain('(keine Sammlung) ×2')

    // Tiles show the full-size scan, with the small one offered via srcset.
    const image = component.find('img[alt="Blue-Eyes White Dragon"]')
    expect(image.attributes('src')).toBe('https://images.example/bewd.jpg')
    expect(image.attributes('srcset')).toContain('https://images.example/bewd-small.jpg')
    expect(image.classes()).toContain('object-contain')

    // Clicking the artwork opens the card detail overlay (#88): the card
    // text, what the user owns per collection with the notes, and a
    // catalog link — but none of the catalog-only sections.
    stubOverlayFetch()
    await component.find('[aria-label="Blue-Eyes White Dragon vergrößern"]').trigger('click')
    await nextTick()
    await vi.waitFor(() => {
      expect(body().find('a[href="/catalog?card=89631139"]').exists()).toBe(true)
      expect(body().text()).toContain('Dieser legendäre Drache')
      expect(body().text()).toContain('Oben links')
    })
    const overlay = body().find('[role="dialog"]').text()
    expect(overlay).toContain('Im Katalog öffnen')
    expect(overlay).toContain('Kartentext')
    expect(overlay).toContain('Im Inventar')
    expect(overlay).toContain('Box 1')
    expect(overlay).toContain('×3')
    expect(overlay).not.toContain('Printings')
    expect(overlay).not.toContain('LOB-001')
  })

  it('renders tile skeletons while the search is loading', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [], total: 0, page: 1, pageSize: 24 }
    state.searchPending = true

    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    await openUebersicht(component)

    expect(component.findAll('.aspect-\\[59\\/86\\].rounded-lg')).toHaveLength(12)
    expect(component.text()).not.toContain('Inventar ist leer')

    state.searchPending = false
  })

  it('shows "Inventar ist leer" when there is no active filter and no results', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [], total: 0, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    await openUebersicht(component)

    expect(component.text()).toContain('Inventar ist leer')
    expect(component.text()).not.toContain('Keine Treffer für diese Filter')
  })

  it('shows "Keine Treffer für diese Filter" when a filter is active but nothing matches', async () => {
    state.inventory = { items: [], total: 0 }
    // A collectionId deep-link counts as an active filter (hasAnyFilter),
    // distinguishing "no results because filtered" from "empty inventory".
    state.facets = { ...emptyFacets }
    state.search = { items: [], total: 0, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventoryPage, { route: '/inventory?collectionId=box-1' })
    await openUebersicht(component)

    expect(component.text()).toContain('Keine Treffer für diese Filter')
    expect(component.text()).not.toContain('Inventar ist leer')
  })
})

const blueEyes: SearchResultItem = {
  catalogCardId: 89631139,
  name: 'Blue-Eyes White Dragon',
  type: 'Normal Monster',
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2500,
  imageSmall: null,
  imageLarge: null,
  totalQuantity: 3,
  collectionBreakdown: [{ collectionId: 'box-1', collectionName: 'Box 1', quantity: 3 }],
}

function toggleButton(component: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  const button = component.findAll('button').find((btn: { text: () => string }) => btn.text() === label)
  expect(button).toBeTruthy()
  return button!
}

describe('view and card filter in the URL', () => {
  it('renders "Übersicht" directly from ?view=overview', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [blueEyes], total: 1, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventoryPage, { route: '/inventory?view=overview' })

    expect(component.find('[aria-label="Blue-Eyes White Dragon vergrößern"]').exists()).toBe(true)
    expect(toggleButton(component, 'Übersicht').attributes('aria-pressed')).toBe('true')
    expect(toggleButton(component, 'Liste').attributes('aria-pressed')).toBe('false')
  })

  it('"In Liste bearbeiten" shows the card\'s rows in "Liste" and stays there (#32)', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [blueEyes], total: 1, page: 1, pageSize: 24 }
    state.calls = []

    const component = await mountSuspended(InventoryPage, { route: '/inventory?collectionId=box-1' })
    const route = useRouter().currentRoute

    // Typing a search flips to "Übersicht" — the watcher that used to flip
    // straight back after "In Liste bearbeiten".
    await component.find('input[aria-label="Inventar durchsuchen"]').setValue('Blue')
    await vi.waitFor(() => {
      expect(route.value.query.view).toBe('overview')
    })
    await nextTick()

    stubOverlayFetch()
    await component.find('[aria-label="Blue-Eyes White Dragon vergrößern"]').trigger('click')
    await vi.waitFor(() => {
      expect(body().text()).toContain('In Liste bearbeiten')
    })
    const editButton = body().findAll('button').find(btn => btn.text().includes('In Liste bearbeiten'))
    await editButton!.trigger('click')

    // Collection scope and view dropped: the breakdown spans all collections.
    await vi.waitFor(() => {
      expect(route.value.query).toEqual({ card: '89631139' })
    })
    await vi.waitFor(() => {
      expect(body().text()).not.toContain('In Liste bearbeiten')
    })

    expect(lastQuery('/api/inventory')).toMatchObject({ catalogCardId: 89631139, collectionId: undefined, q: undefined })
    expect(component.text()).toContain('Nur: Blue-Eyes White Dragon')
    expect(component.find<HTMLInputElement>('input[aria-label="Inventar durchsuchen"]').element.value).toBe('')

    // Past the search debounce, nothing flips the view back.
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(route.value.query.view).toBeUndefined()
    expect(route.value.query.card).toBe('89631139')
    expect(toggleButton(component, 'Liste').attributes('aria-pressed')).toBe('true')
  })

  it('drops the card filter from the chip and when switching to "Übersicht"', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [blueEyes], total: 1, page: 1, pageSize: 24 }
    state.calls = []

    const component = await mountSuspended(InventoryPage, { route: '/inventory?card=89631139' })
    const route = useRouter().currentRoute

    expect(lastQuery('/api/inventory')).toMatchObject({ catalogCardId: 89631139 })
    expect(component.text()).toContain('Nur: Karte')
    expect(component.text()).toContain('Keine Treffer')

    await toggleButton(component, 'Übersicht').trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query).toEqual({ view: 'overview' })
    })

    await toggleButton(component, 'Liste').trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query).toEqual({})
    })
    expect(lastQuery('/api/inventory').catalogCardId).toBeUndefined()

    await useRouter().replace('/inventory?card=89631139')
    await vi.waitFor(() => {
      expect(component.find('[aria-label="Kartenfilter entfernen"]').exists()).toBe(true)
    })
    await component.find('[aria-label="Kartenfilter entfernen"]').trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.card).toBeUndefined()
    })
  })
})
