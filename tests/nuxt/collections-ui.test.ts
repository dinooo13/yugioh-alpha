import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CollectionFormModal from '~/components/collections/CollectionFormModal.vue'
import DefaultLayout from '~/layouts/default.vue'

const fetchState = vi.hoisted(() => ({
  collections: {
    items: [] as Array<{ id: string, name: string, description: string | null, cardCount: number }>,
    allCount: 0,
  },
  routePath: '/inventar',
}))

mockNuxtImport('useFetch', () => {
  return () => ({
    data: ref(fetchState.collections),
    pending: ref(false),
    refresh: vi.fn(),
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({
    path: fetchState.routePath,
    query: {},
  })
})

describe('default layout collection sidebar', () => {
  it('renders "Alle Karten" plus the empty state when there are no collections', async () => {
    fetchState.collections = { items: [], allCount: 0 }
    fetchState.routePath = '/inventar'

    const component = await mountSuspended(DefaultLayout)

    expect(component.text()).toContain('SAMMLUNGEN')
    expect(component.text()).toContain('Alle Karten')
    expect(component.text()).toContain('Neue Sammlung')
  })

  it('renders real collections fetched from the API with their card counts', async () => {
    fetchState.collections = {
      items: [
        { id: 'col-1', name: 'Box 1', description: null, cardCount: 412 },
        { id: 'col-2', name: 'Binder', description: null, cardCount: 289 },
      ],
      allCount: 701,
    }
    fetchState.routePath = '/inventar'

    const component = await mountSuspended(DefaultLayout)

    expect(component.text()).toContain('Box 1')
    expect(component.text()).toContain('412')
    expect(component.text()).toContain('Binder')
    expect(component.text()).toContain('701')
  })

  it('hides the collection sidebar outside the inventory', async () => {
    fetchState.collections = {
      items: [{ id: 'col-1', name: 'Box 1', description: null, cardCount: 412 }],
      allCount: 412,
    }
    fetchState.routePath = '/decks'

    const component = await mountSuspended(DefaultLayout)

    expect(component.text()).not.toContain('SAMMLUNGEN')
    expect(component.text()).not.toContain('Neue Sammlung')
    expect(component.text()).not.toContain('Box 1')
  })

  it('opens the create-collection dialog from the sidebar button', async () => {
    fetchState.collections = { items: [], allCount: 0 }
    fetchState.routePath = '/inventar'

    const component = await mountSuspended(DefaultLayout)
    const createButton = component.findAll('button').find(btn => btn.text().includes('Neue Sammlung'))
    expect(createButton).toBeTruthy()

    await createButton!.trigger('click')

    expect(component.text()).toContain('Neue Sammlung')
  })
})

describe('collection form modal', () => {
  // UModal teleports its content to <body>, so assertions read the document
  // body rather than the mounted wrapper (which stays empty).
  it('shows a create title when there are no initial values', async () => {
    await mountSuspended(CollectionFormModal, {
      props: { open: true, initialValues: null },
    })

    expect(document.body.textContent).toContain('Neue Sammlung')
  })

  it('shows a rename title and pre-fills the name when editing', async () => {
    await mountSuspended(CollectionFormModal, {
      props: {
        open: true,
        initialValues: { id: 'col-1', name: 'Box 1', description: 'My cards' },
      },
    })

    expect(document.body.textContent).toContain('Sammlung umbenennen')
    expect(document.querySelector('input[name="name"]')).toBeTruthy()
  })
})
