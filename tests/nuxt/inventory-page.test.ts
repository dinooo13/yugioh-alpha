import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Component } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CollectionActions from '~/components/collections/CollectionActions.vue'
import AddToInventoryModal from '~/components/inventory/AddToInventoryModal.vue'
import InventoryCardTile from '~/components/inventory/InventoryCardTile.vue'
import InventoryListRow from '~/components/inventory/InventoryListRow.vue'
import { UApp } from '#components'
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
    expect(component.text()).toContain('Normales Monster')
    expect(component.text()).toContain('×3')

    // One responsive markup for every width — each control exists once.
    expect(component.findAll('[aria-label="Sammlung für Dark Magician"]')).toHaveLength(1)
    expect(component.findAll('[aria-label="Karte bearbeiten"]')).toHaveLength(1)
    expect(component.findAll('[aria-label="Karte entfernen"]')).toHaveLength(1)
    // No collector details since ADR 0017.
    expect(component.text()).not.toMatch(/Drucksprache|Zustand|Auflage|Legend of Blue Eyes|Ultra Rare/)

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
    expect(text).toContain('Note: Binder 2')
    expect(text).not.toMatch(/Printing language|Condition|Near Mint/)
    expect(text).not.toMatch(/Karte|Sammlung|Übersicht|Liste/)
  })

  it('shows the note of a row', async () => {
    inventoryState.pending = false
    inventoryState.response = ownedDarkMagician()

    const component = await mountSuspended(InventoryPage)

    const note = component.find('li p[title="Binder 2"]')
    expect(note.exists()).toBe(true)
    // The sr-only prefix names the field for screen readers.
    expect(note.text()).toBe('Notiz: Binder 2')
  })

  it('formats large quantities for the locale (#62)', async () => {
    inventoryState.pending = false
    inventoryState.response = ownedDarkMagician({ quantity: 1234 })

    const component = await mountSuspended(InventoryPage)

    expect(component.text()).toContain('×1.234')
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

function ownedDarkMagician(overrides: Record<string, unknown> = {}) {
  return {
    total: 1,
    items: [
      {
        id: 'owned-1',
        catalogCardId: 46986414,
        collectionId: null,
        quantity: 3,
        note: 'Binder 2',
        cardName: 'Dark Magician',
        cardType: 'Normal Monster',
        imageUrlSmall: 'https://images.example/dm-small.jpg',
        ...overrides,
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

  it('formats the collection counts for the locale (#62)', async () => {
    const component = await mountSuspended(CollectionActions, {
      props: { modelValue: '', collections: [], allCount: 1234, unassignedCount: 0 },
    })

    expect(component.text()).toContain('Alle Sammlungen (1.234)')
  })

  it('asks only for quantity, collection and note (ADR 0017)', async () => {
    const component = await mountSuspended(AddToInventoryModal, {
      props: {
        open: true,
        card: { id: 46986414, name: 'Dark Magician', type: 'Normal Monster' },
      },
    })
    await nextTick()

    const text = document.body.textContent ?? ''
    expect(text).toContain('Anzahl')
    expect(text).toContain('Sammlung')
    expect(text).toContain('Notiz')
    expect(text).not.toMatch(/Drucksprache|Zustand|Auflage|Set-Ausgabe/)

    component.unmount()
  })
})

describe('retired card badge (ADR 0019)', () => {
  // The badge's tooltip needs the provider UApp gives the real app.
  function inApp(component: Component, props: Record<string, unknown>) {
    return mountSuspended(defineComponent({
      setup: () => () => h(UApp, null, { default: () => h(component, props) }),
    }))
  }

  const listItem = ownedDarkMagician().items[0]!
  const listProps = { assignItems: [], noAssignmentValue: '__none__' }
  const tileItem = {
    catalogCardId: 46986414,
    name: 'Dark Magician',
    type: 'Normal Monster',
    attribute: 'DARK',
    race: 'Spellcaster',
    level: 7,
    atk: 2500,
    def: 2100,
    imageSmall: null,
    totalQuantity: 2,
    collectionBreakdown: [],
  }

  it('shows on a list row only when the card is retired', async () => {
    const retired = await inApp(InventoryListRow, { ...listProps, item: { ...listItem, cardRetired: true } })
    expect(retired.find('[data-testid="card-retired-badge"]').text()).toBe('Nicht mehr im Katalog')

    const active = await inApp(InventoryListRow, { ...listProps, item: { ...listItem, cardRetired: false } })
    expect(active.find('[data-testid="card-retired-badge"]').exists()).toBe(false)
  })

  it('shows on an overview tile only when the card is retired', async () => {
    const retired = await inApp(InventoryCardTile, { item: { ...tileItem, retired: true } })
    expect(retired.find('[data-testid="card-retired-badge"]').text()).toBe('Nicht mehr im Katalog')

    const active = await inApp(InventoryCardTile, { item: { ...tileItem, retired: false } })
    expect(active.find('[data-testid="card-retired-badge"]').exists()).toBe(false)
  })
})
