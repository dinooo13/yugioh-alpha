import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import KatalogPage from '~/pages/katalog.vue'

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

describe('katalog page', () => {
  it('renders German catalog controls and result tiles', async () => {
    const component = await mountSuspended(KatalogPage)

    expect(component.text()).toContain('Katalog')
    expect(component.find('input[aria-label="Karten suchen"]').exists()).toBe(true)
    expect(component.find('select[aria-label="Typ"]').exists()).toBe(true)
    expect(component.text()).toContain('Blue-Eyes White Dragon')
  })
})
