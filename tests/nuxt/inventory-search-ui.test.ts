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

// The card detail overlay (#88) loads the card from the catalog and its
// editor (#135) the card's rows from the inventory.
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
      return Promise.resolve({ items: [{ id: 'row-1', collectionId: 'box-1', quantity: 3, note: 'Oben links' }], total: 1 })
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

const collections = {
  items: [{ id: 'box-1', name: 'Box 1', description: null, cardCount: 3, visibility: 'private' }],
  allCount: 5,
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
    if (url === '/api/collections') {
      return { data: ref(collections), pending: ref(false), status: ref('success'), refresh: vi.fn() }
    }
    return { data: ref(state.inventory), pending: ref(false), refresh: vi.fn() }
  }
})

function lastQuery(url: string): Record<string, unknown> {
  const call = state.calls.filter(c => c.url === url).at(-1)
  return toValue(call?.opts?.query as Record<string, unknown>)
}

async function openGalerie(component: Awaited<ReturnType<typeof mountSuspended>>) {
  const toggle = component.findAll('button').find((btn: { text: () => string }) => btn.text().includes('Galerie'))
  expect(toggle).toBeTruthy()
  await toggle!.trigger('click')
  const route = useRouter().currentRoute
  await vi.waitFor(() => {
    expect(route.value.query.view).toBe('gallery')
  })
  await nextTick()
}

// A gallery tile opens through its name button (the whole tile is its target).
function tileButton(component: Awaited<ReturnType<typeof mountSuspended>>, name: string) {
  const button = component.findAll('article button').find((btn: { text: () => string }) => btn.text() === name)
  expect(button).toBeTruthy()
  return button!
}

describe('inventory search panel (Galerie)', () => {
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
    await openGalerie(component)

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

    // Clicking the tile opens the card detail overlay (#88) with the
    // editor for the user's copies (#135), the card text and a catalog
    // link — but none of the catalog-only sections.
    stubOverlayFetch()
    await tileButton(component, 'Blue-Eyes White Dragon').trigger('click')
    await nextTick()
    await vi.waitFor(() => {
      expect(body().find('a[href="/catalog?card=89631139"]').exists()).toBe(true)
      expect(body().text()).toContain('Dieser legendäre Drache')
      expect(body().text()).toContain('Oben links')
    })
    const dialog = body().find('[role="dialog"]')
    const overlay = dialog.text()
    expect(overlay).toContain('Im Katalog öffnen')
    expect(overlay).toContain('Kartentext')
    expect(overlay).toContain('Im Inventar')
    expect(overlay).toContain('×3 ges.')
    expect(dialog.find<HTMLInputElement>('[aria-label="Anzahl in Box 1"]').element.value).toBe('3')
    expect(dialog.find('[aria-label="Sammlung ändern (jetzt: Box 1)"]').exists()).toBe(true)
    // From the gallery no row is singled out.
    expect(dialog.find('[data-focused]').exists()).toBe(false)
    expect(overlay).not.toContain('In Liste bearbeiten')
    expect(overlay).not.toContain('Printings')
    expect(overlay).not.toContain('LOB-001')
  })

  it('renders tile skeletons while the search is loading', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [], total: 0, page: 1, pageSize: 24 }
    state.searchPending = true

    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    await openGalerie(component)

    expect(component.findAll('.aspect-\\[59\\/86\\].rounded-lg')).toHaveLength(12)
    expect(component.text()).not.toContain('Inventar ist leer')

    state.searchPending = false
  })

  it('shows "Inventar ist leer" when there is no active filter and no results', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [], total: 0, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    await openGalerie(component)

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
    await openGalerie(component)

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

describe('view in the URL', () => {
  it('renders "Galerie" directly from ?view=gallery', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [blueEyes], total: 1, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventoryPage, { route: '/inventory?view=gallery' })

    tileButton(component, 'Blue-Eyes White Dragon')
    expect(toggleButton(component, 'Galerie').attributes('aria-pressed')).toBe('true')
    expect(toggleButton(component, 'Liste').attributes('aria-pressed')).toBe('false')
  })

  it('still accepts the former ?view=overview and rewrites it to gallery', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [blueEyes], total: 1, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventoryPage, { route: '/inventory?view=overview&collectionId=box-1' })
    const route = useRouter().currentRoute

    tileButton(component, 'Blue-Eyes White Dragon')
    expect(toggleButton(component, 'Galerie').attributes('aria-pressed')).toBe('true')
    await vi.waitFor(() => {
      expect(route.value.query).toEqual({ view: 'gallery', collectionId: 'box-1' })
    })
  })

  it('switches between "Liste" and "Galerie" without writing the default', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [blueEyes], total: 1, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventoryPage, { route: '/inventory' })
    const route = useRouter().currentRoute

    await toggleButton(component, 'Galerie').trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query).toEqual({ view: 'gallery' })
    })
    await toggleButton(component, 'Liste').trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query).toEqual({})
    })
  })

  it('drops a stale ?card= (the former list filter) and lists every card', async () => {
    state.inventory = { items: [], total: 0 }
    state.facets = { ...emptyFacets }
    state.search = { items: [blueEyes], total: 1, page: 1, pageSize: 24 }
    state.calls = []

    await mountSuspended(InventoryPage, { route: '/inventory?card=89631139' })
    const route = useRouter().currentRoute

    await vi.waitFor(() => {
      expect(route.value.query).toEqual({})
    })
    expect(lastQuery('/api/inventory')).not.toHaveProperty('catalogCardId')
  })
})
