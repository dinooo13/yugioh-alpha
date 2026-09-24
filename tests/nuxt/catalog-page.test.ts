import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CatalogPage from '~/pages/catalog.vue'
import { setTestLocale } from './fixtures/locale'

const catalogState = vi.hoisted(() => ({ total: 1 }))

// UModal teleports its content to <body> (same note as in collections-ui.test.ts).
function body() {
  return new DOMWrapper(document.body)
}

afterEach(async () => {
  document.body.innerHTML = ''
  catalogState.total = 1
  await setTestLocale('de')
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
          total: catalogState.total,
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
    const component = await mountSuspended(CatalogPage)

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
    const component = await mountSuspended(CatalogPage)

    const addButton = component.findAll('button').find(btn => btn.text() === 'Zum Inventar')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(body().text()).toContain('Karte hinzufügen')
    expect(body().text()).toContain('Blue-Eyes White Dragon')
    expect(body().text()).toContain('Drucksprache')
    expect(body().text()).toContain('Neuwertig (Near Mint)')
  })

  it('shows the result count with a thousands separator and the right plural', async () => {
    const one = await mountSuspended(CatalogPage)
    expect(one.text()).toContain('1 Karte')
    expect(one.text()).not.toContain('1 Karten')
    one.unmount()

    catalogState.total = 13_000
    const many = await mountSuspended(CatalogPage)
    expect(many.text()).toContain('13.000 Karten')
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    catalogState.total = 13_000
    const component = await mountSuspended(CatalogPage)

    const text = component.text()
    expect(text).toContain('Catalog')
    expect(text).toContain('13,000 cards')
    expect(text).toContain('Add to inventory')
    expect(text).toContain('Add to wishlist')
    expect(text).toContain('Lv 8')
    expect(component.find('input[aria-label="Search cards"]').exists()).toBe(true)
    expect(component.find('select[aria-label="Type"]').exists()).toBe(true)
    expect(text).not.toContain('Karten')
    expect(text).not.toContain('Zum Inventar')

    const addButton = component.findAll('button').find(btn => btn.text() === 'Add to inventory')
    await addButton!.trigger('click')

    const modal = body().text()
    expect(modal).toContain('Add card')
    expect(modal).toContain('Printing language')
    expect(modal).toContain('Near Mint')
    expect(modal).not.toContain('Neuwertig')
  })
})
