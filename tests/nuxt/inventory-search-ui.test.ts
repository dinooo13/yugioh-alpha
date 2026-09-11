import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import InventarPage from '~/pages/inventar.vue'

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
  totalQuantity: number
  collectionBreakdown?: SearchCollectionBreakdown[]
}

const emptyFacets = {
  types: [] as string[],
  attributes: [] as string[],
  races: [] as string[],
  levels: [] as number[],
  sets: [] as Array<{ id: string, name: string }>,
  languages: [] as string[],
  conditions: [] as string[],
  editions: [] as string[],
}

const state = vi.hoisted(() => ({
  inventory: { items: [] as Array<Record<string, unknown>>, total: 0 },
  search: { items: [] as SearchResultItem[], total: 0, page: 1, pageSize: 24 },
  facets: {
    types: [] as string[],
    attributes: [] as string[],
    races: [] as string[],
    levels: [] as number[],
    sets: [] as Array<{ id: string, name: string }>,
    languages: [] as string[],
    conditions: [] as string[],
    editions: [] as string[],
  },
  routeQuery: {} as Record<string, string>,
}))

mockNuxtImport('useFetch', () => {
  return (url: string) => {
    if (url === '/api/inventory/search') {
      return { data: ref(state.search), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (url === '/api/inventory/search/facets') {
      return { data: ref(state.facets), pending: ref(false), refresh: vi.fn() }
    }
    return { data: ref(state.inventory), pending: ref(false), refresh: vi.fn() }
  }
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/inventar', query: state.routeQuery })
})

async function openUebersicht(component: Awaited<ReturnType<typeof mountSuspended>>) {
  const toggle = component.findAll('button').find((btn: { text: () => string }) => btn.text().includes('Übersicht'))
  expect(toggle).toBeTruthy()
  await toggle!.trigger('click')
}

describe('inventory search panel (Übersicht)', () => {
  it('renders filter controls, total quantity, and the per-collection breakdown', async () => {
    state.inventory = { items: [], total: 0 }
    state.routeQuery = {}
    state.facets = {
      ...emptyFacets,
      types: ['Normal Monster'],
      attributes: ['LIGHT'],
      races: ['Dragon'],
      languages: ['en', 'de'],
      conditions: ['near_mint'],
      editions: ['first'],
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
          imageSmall: null,
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

    const component = await mountSuspended(InventarPage)
    await openUebersicht(component)

    const text = component.text()

    // Filter panel controls (catalog + ownership facets, sort, reset).
    expect(text).toContain('Katalog')
    expect(text).toContain('Besitz')
    expect(text).toContain('Sortierung')
    expect(text).toContain('Reset')

    // Aggregated result: name, total quantity, and per-collection breakdown.
    expect(text).toContain('Blue-Eyes White Dragon')
    expect(text).toContain('1 Karte')
    expect(text).toContain('×5 ges.')
    expect(text).toContain('Box 1 ×3')
    expect(text).toContain('(keine Sammlung) ×2')
  })

  it('shows "Inventar ist leer" when there is no active filter and no results', async () => {
    state.inventory = { items: [], total: 0 }
    state.routeQuery = {}
    state.facets = { ...emptyFacets }
    state.search = { items: [], total: 0, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventarPage)
    await openUebersicht(component)

    expect(component.text()).toContain('Inventar ist leer')
    expect(component.text()).not.toContain('Keine Treffer für diese Filter')
  })

  it('shows "Keine Treffer für diese Filter" when a filter is active but nothing matches', async () => {
    state.inventory = { items: [], total: 0 }
    // A collectionId deep-link counts as an active filter (hasAnyFilter),
    // distinguishing "no results because filtered" from "empty inventory".
    state.routeQuery = { collectionId: 'box-1' }
    state.facets = { ...emptyFacets }
    state.search = { items: [], total: 0, page: 1, pageSize: 24 }

    const component = await mountSuspended(InventarPage)
    await openUebersicht(component)

    expect(component.text()).toContain('Keine Treffer für diese Filter')
    expect(component.text()).not.toContain('Inventar ist leer')
  })
})
