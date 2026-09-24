import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AddToInventoryModal from '~/components/inventory/AddToInventoryModal.vue'
import InventoryPage from '~/pages/inventory/index.vue'
import { setTestLocale } from './fixtures/locale'

afterEach(() => setTestLocale('de'))

const inventoryState = vi.hoisted(() => ({
  response: {
    items: [] as Array<Record<string, unknown>>,
    total: 0,
  },
  pending: false,
}))

mockNuxtImport('useFetch', () => {
  return () => ({
    data: ref(inventoryState.response),
    pending: ref(inventoryState.pending),
    refresh: vi.fn(),
  })
})

describe('inventory page', () => {
  it('renders the empty inventory state', async () => {
    inventoryState.response = { items: [], total: 0 }
    inventoryState.pending = false

    const component = await mountSuspended(InventoryPage)

    expect(component.text()).toContain('Keine Karten im Inventar')
    expect(component.text()).toContain('Karte hinzufügen')
  })

  it('renders owned cards from the inventory API', async () => {
    inventoryState.pending = false
    inventoryState.response = ownedDarkMagician()

    const component = await mountSuspended(InventoryPage)

    expect(component.text()).toContain('Dark Magician')
    expect(component.text()).toContain('Normal Monster')
    expect(component.text()).toContain('×3')
    expect(component.text()).toContain('NM')

    // One responsive markup for every width — each control exists once.
    expect(component.findAll('[aria-label="Sammlung für Dark Magician"]')).toHaveLength(1)
    expect(component.findAll('[aria-label="Karte bearbeiten"]')).toHaveLength(1)
    expect(component.findAll('[aria-label="Karte entfernen"]')).toHaveLength(1)
    // The printing language is labelled "Drucksprache" (ADR 0014 terminology).
    expect(component.find('[title="Drucksprache: EN"]').exists()).toBe(true)
    expect(component.find('[title="Zustand: NM"]').exists()).toBe(true)
    expect(component.find('[title="Auflage: 1st"]').exists()).toBe(true)

    // The thumbnail keeps the whole card visible instead of cropping it.
    const thumbnail = component.find('img[alt="Dark Magician"]')
    expect(thumbnail.exists()).toBe(true)
    expect(thumbnail.classes()).toContain('object-contain')
    expect(thumbnail.classes()).not.toContain('object-cover')
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    inventoryState.pending = false
    inventoryState.response = ownedDarkMagician()

    const component = await mountSuspended(InventoryPage)

    const text = component.text()
    expect(component.find('h1').text()).toBe('All cards')
    expect(text).toContain('0 cards')
    expect(text).toContain('Quick entry')
    expect(text).toContain('Add card')
    expect(text).toContain('List')
    expect(text).toContain('Overview')
    expect(text).toContain('Also search card text')
    expect(text).toContain('New collection')
    expect(component.find('input[aria-label="Search inventory"]').exists()).toBe(true)
    expect(component.findAll('[aria-label="Collection for Dark Magician"]')).toHaveLength(1)
    expect(component.findAll('[aria-label="Edit card"]')).toHaveLength(1)
    expect(component.findAll('[aria-label="Remove card"]')).toHaveLength(1)
    expect(component.find('[title="Printing language: EN"]').exists()).toBe(true)
    expect(component.find('[title="Condition: NM"]').exists()).toBe(true)
    expect(text).not.toMatch(/Karte|Sammlung|Übersicht|Liste/)
  })

  it('renders skeleton rows while the list is loading', async () => {
    inventoryState.response = { items: [], total: 0 }
    inventoryState.pending = true

    const component = await mountSuspended(InventoryPage)

    expect(component.text()).not.toContain('Inventar wird geladen...')
    expect(component.find('ul[aria-busy="true"]').exists()).toBe(true)
    expect(component.findAll('ul[aria-busy="true"] li')).toHaveLength(5)

    inventoryState.pending = false
  })
})

function ownedDarkMagician() {
  return {
    total: 1,
    items: [
      {
        id: 'owned-1',
        catalogCardId: 46986414,
        printingId: 'LOB-005',
        quantity: 3,
        language: 'en',
        condition: 'near_mint',
        edition: 'first',
        note: null,
        cardName: 'Dark Magician',
        cardType: 'Normal Monster',
        imageUrlSmall: 'https://images.example/dm-small.jpg',
        setName: 'Legend of Blue Eyes White Dragon',
        rarity: 'Ultra Rare',
      },
    ] as Array<Record<string, unknown>>,
  }
}

describe('add to inventory modal', () => {
  it('opens repeatedly without logging select errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const component = await mountSuspended(AddToInventoryModal, {
      props: {
        open: false,
        card: {
          id: 46986414,
          name: 'Dark Magician',
          type: 'Normal Monster',
          printings: [
            {
              id: 'LOB-005',
              setName: 'Legend of Blue Eyes White Dragon',
              rarity: 'Ultra Rare',
            },
          ],
        },
      },
    })

    await component.setProps({ open: true })
    await nextTick()
    await component.setProps({ open: false })
    await nextTick()
    await component.setProps({ open: true })
    await nextTick()

    expect(consoleError).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
