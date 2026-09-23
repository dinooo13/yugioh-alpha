import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import KatalogPage from '~/pages/catalog.vue'

// UModal teleports its content to <body> (same note as in collections-ui.test.ts).
function body() {
  return new DOMWrapper(document.body)
}

afterEach(() => {
  document.body.innerHTML = ''
})

mockNuxtImport('useFetch', () => {
  return vi.fn((url: string | (() => string | null)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url

    if (resolvedUrl === '/api/catalog/facets') {
      return {
        data: ref({
          types: ['Normal Monster'],
          attributes: ['LIGHT'],
          races: ['Dragon'],
          levels: [8],
          sets: [{ id: 'legend-of-blue-eyes', name: 'Legend of Blue Eyes' }],
        }),
      }
    }

    if (resolvedUrl === '/api/catalog/cards') {
      return {
        data: ref({
          items: [{
            id: 1,
            name: 'Blue-Eyes White Dragon',
            type: 'Normal Monster',
            frameType: 'normal',
            attribute: 'LIGHT',
            race: 'Dragon',
            level: 8,
            atk: 3000,
            def: 2500,
            imageSmall: 'https://img/blue-small.jpg',
          }],
          total: 1,
          page: 1,
          pageSize: 24,
        }),
        pending: ref(false),
        error: ref(null),
        refresh: vi.fn(),
      }
    }

    return {
      data: ref(null),
      pending: ref(false),
      error: ref(null),
    }
  })
})

describe('catalog page', () => {
  it('renders German catalog controls and result tiles', async () => {
    const component = await mountSuspended(KatalogPage)

    expect(component.text()).toContain('Katalog')
    expect(component.find('input[aria-label="Karten suchen"]').exists()).toBe(true)
    expect(component.find('select[aria-label="Typ"]').exists()).toBe(true)
    expect(component.text()).toContain('Blue-Eyes White Dragon')

    // The set filter used to be a native `<select>` with 1000+ unsearchable
    // options (UX review #5) — now a searchable `USelectMenu`.
    expect(component.find('select[aria-label="Set"]').exists()).toBe(false)
    expect(component.find('[aria-label="Set"]').exists()).toBe(true)
  })

  it('opens the add-to-inventory modal pre-filled with the clicked card (#6)', async () => {
    const component = await mountSuspended(KatalogPage)

    const addButton = component.findAll('button').find(btn => btn.text() === 'Zum Inventar')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(body().text()).toContain('Karte hinzufügen')
    expect(body().text()).toContain('Blue-Eyes White Dragon')
  })
})
