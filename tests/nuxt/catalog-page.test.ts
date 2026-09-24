import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CatalogPage from '~/pages/catalog.vue'
import { setTestLocale } from './fixtures/locale'

const catalogState = vi.hoisted(() => ({
  total: 1,
  // One `pending` for the card search across mounts, so a test can flip the
  // grid to its loading skeletons (#98).
  searchPending: null as null | { value: boolean },
}))

// UModal teleports its content to <body> (same note as in collections-ui.test.ts).
function body() {
  return new DOMWrapper(document.body)
}

// Every mounted page is unmounted before the body is cleared: a page left
// mounted (with its teleported modal) would re-render into the cleared body
// on the next route change.
const mounted: Array<{ unmount: () => void }> = []

async function mountPage(options: { route?: string } = {}) {
  const component = await mountSuspended(CatalogPage, options)
  mounted.push(component)
  return component
}

afterEach(async () => {
  for (const component of mounted.splice(0)) {
    component.unmount()
  }
  document.body.innerHTML = ''
  catalogState.total = 1
  if (catalogState.searchPending) {
    catalogState.searchPending.value = false
  }
  useState('card-locale-choice').value = null
  vi.unstubAllGlobals()
  await useRouter().replace('/catalog')
  await setTestLocale('de')
})

function cardDetail(overrides: { nameDe?: string | null, descDe?: string | null } = {}, printings: Array<{ setCode: string, setName: string, rarity: string | null, price: string | null }> = []) {
  return {
    card: {
      id: 1,
      name: 'Blue-Eyes White Dragon',
      nameDe: 'Blauäugiger w. Drache',
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
      tcgDate: null,
      ocgDate: null,
      ygoprodeckUrl: null,
      ...overrides,
    },
    printings,
    images: [],
  }
}

async function openDetail(detail: ReturnType<typeof cardDetail>) {
  vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(detail)))
  // The detail opens through the route (`?card=`), then loads the card.
  const component = await mountPage({ route: '/catalog?card=1' })
  await flushPromises()
  return component
}

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
            nameDe: 'Blauäugiger w. Drache',
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
        pending: (catalogState.searchPending ??= ref(false)),
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
    const component = await mountPage()

    expect(component.text()).toContain('Katalog')
    expect(component.find('input[aria-label="Karten suchen"]').exists()).toBe(true)
    expect(component.find('select[aria-label="Typ"]').exists()).toBe(true)
    // German card names by default: the card language follows the interface (ADR 0015).
    expect(component.text()).toContain('Blauäugiger w. Drache')
    expect(component.text()).not.toContain('Blue-Eyes White Dragon')

    // The set filter used to be a native `<select>` with 1000+ unsearchable
    // options (UX review #5) — now a searchable `USelectMenu`.
    expect(component.find('select[aria-label="Set"]').exists()).toBe(false)
    expect(component.find('[aria-label="Set"]').exists()).toBe(true)
  })

  it('opens the add-to-inventory modal pre-filled with the clicked card (#6)', async () => {
    const component = await mountPage()

    const addButton = component.findAll('button').find(btn => btn.text() === 'Zum Inventar')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(body().text()).toContain('Karte hinzufügen')
    expect(body().text()).toContain('Blauäugiger w. Drache')
    expect(body().text()).toContain('Anzahl')
    expect(body().text()).toContain('Sammlung')
    // No collector details since ADR 0017.
    expect(body().text()).not.toContain('Drucksprache')
  })

  it('keeps a wishlist toggle that finishes while the grid reloads (#98)', async () => {
    const component = await mountPage()
    let finish!: () => void
    vi.stubGlobal('$fetch', vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    })))

    const wishlistButton = component.findAll('button').find(btn => btn.text() === 'Zur Wunschliste')
    await wishlistButton!.trigger('click')

    // A new search starts: the tiles make way for skeletons…
    catalogState.searchPending!.value = true
    await nextTick()
    expect(component.text()).not.toContain('Zur Wunschliste')

    // …the toggle finishes meanwhile, and the new grid shows it.
    finish()
    await flushPromises()
    catalogState.searchPending!.value = false
    await nextTick()
    expect(component.text()).toContain('Auf der Wunschliste')
  })

  it('shows the result count with a thousands separator and the right plural', async () => {
    const one = await mountPage()
    expect(one.text()).toContain('1 Karte')
    expect(one.text()).not.toContain('1 Karten')

    catalogState.total = 13_000
    const many = await mountPage()
    expect(many.text()).toContain('13.000 Karten')
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    catalogState.total = 13_000
    const component = await mountPage()

    const text = component.text()
    expect(text).toContain('Catalog')
    expect(text).toContain('13,000 cards')
    expect(text).toContain('Add to inventory')
    expect(text).toContain('Add to wishlist')
    expect(text).toContain('Lv 8')
    expect(text).toContain('Blue-Eyes White Dragon')
    expect(text).not.toContain('Blauäugiger')
    expect(component.find('input[aria-label="Search cards"]').exists()).toBe(true)
    expect(component.find('select[aria-label="Type"]').exists()).toBe(true)
    expect(text).not.toContain('Karten')
    expect(text).not.toContain('Zum Inventar')

    const addButton = component.findAll('button').find(btn => btn.text() === 'Add to inventory')
    await addButton!.trigger('click')

    const modal = body().text()
    expect(modal).toContain('Add card')
    expect(modal).toContain('Quantity')
    expect(modal).toContain('Collection')
    expect(modal).not.toContain('Anzahl')
  })

  it('shows English card names in a German interface when the profile says so', async () => {
    useState('card-locale-choice').value = 'en'
    const component = await mountPage()

    expect(component.text()).toContain('Katalog')
    expect(component.text()).toContain('Blue-Eyes White Dragon')
    expect(component.text()).not.toContain('Blauäugiger')
  })

  it('shows the German name, the English name, the German text and no source credit in the detail', async () => {
    await openDetail(cardDetail())
    const detail = body().text()

    expect(detail).toContain('Blauäugiger w. Drache')
    expect(detail).toContain('Englisch: Blue-Eyes White Dragon')
    expect(detail).toContain('Dieser legendäre Drache')
    expect(detail).not.toContain('powerful engine')
    // No source credit in the UI (#87, ADR 0017); the README names the source.
    expect(detail).not.toContain('Deutsche Kartentexte')
    expect(body().find('a[href*="yugioh-card-history"]').exists()).toBe(false)
  })

  it('shows the printings and the actions in the detail; "Zum Inventar" opens the add dialog on top (#88)', async () => {
    await openDetail(cardDetail({}, [{ setCode: 'LOB-001', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: null }]))

    const dialog = body().find('[role="dialog"]')
    expect(dialog.find('h2').text()).toBe('Blauäugiger w. Drache')
    expect(dialog.text()).toContain('Printings')
    expect(dialog.text()).toContain('Legend of Blue Eyes White Dragon')
    expect(dialog.text()).toMatch(/LOB-001\s*·\s*Ultra Rare/)
    expect(dialog.text()).toContain('Zur Wunschliste')

    const addButton = dialog.findAll('button').find(btn => btn.text() === 'Zum Inventar')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    await vi.waitFor(() => {
      expect(body().findAll('[role="dialog"]')).toHaveLength(2)
    })
    const addDialog = body().findAll('[role="dialog"]')[1]!
    expect(addDialog.text()).toContain('Karte hinzufügen')
    expect(addDialog.text()).toContain('Blauäugiger w. Drache')
  })

  it('falls back to the English text with a hint when a card has no German data', async () => {
    await openDetail(cardDetail({ nameDe: null, descDe: null }))
    const detail = body().text()

    expect(detail).toContain('Blue-Eyes White Dragon')
    expect(detail).not.toContain('Englisch:')
    expect(detail).toContain('powerful engine')
    expect(detail).toContain('Für diese Karte gibt es keinen deutschen Kartentext.')
    expect(detail).not.toContain('Deutsche Kartentexte')
  })

  it('shows only English in the detail in English', async () => {
    await setTestLocale('en')
    await openDetail(cardDetail())
    const detail = body().text()

    expect(detail).toContain('Blue-Eyes White Dragon')
    expect(detail).toContain('powerful engine')
    expect(detail).not.toContain('Blauäugiger')
    expect(detail).not.toContain('English:')
    expect(detail).not.toContain('German card texts')
  })
})
