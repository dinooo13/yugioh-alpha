import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AddToInventoryModal from '~/components/inventory/AddToInventoryModal.vue'
import InventarPage from '~/pages/inventar.vue'

const inventoryState = vi.hoisted(() => ({
  response: {
    items: [] as Array<Record<string, unknown>>,
    total: 0,
  },
}))

mockNuxtImport('useFetch', () => {
  return () => ({
    data: ref(inventoryState.response),
    pending: ref(false),
    refresh: vi.fn(),
  })
})

describe('inventar page', () => {
  it('renders the empty inventory state', async () => {
    inventoryState.response = { items: [], total: 0 }

    const component = await mountSuspended(InventarPage)

    expect(component.text()).toContain('Keine Karten im Inventar')
    expect(component.text()).toContain('Karte hinzufügen')
  })

  it('renders owned cards from the inventory API', async () => {
    inventoryState.response = {
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
      ],
    }

    const component = await mountSuspended(InventarPage)

    expect(component.text()).toContain('Dark Magician')
    expect(component.text()).toContain('Normal Monster')
    expect(component.text()).toContain('×3')
    expect(component.text()).toContain('NM')
  })
})

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
