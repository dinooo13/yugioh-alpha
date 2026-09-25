// "Zum Deck" in the catalog's card detail (#148).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { CardAddToDeckMenu, UDropdownMenu } from '#components'
import { setTestLocale } from './fixtures/locale'

const { toastAdd } = vi.hoisted(() => ({ toastAdd: vi.fn() }))

mockNuxtImport('useToast', () => {
  return () => ({ add: toastAdd })
})

enableAutoUnmount(afterEach)

afterEach(async () => {
  toastAdd.mockReset()
  vi.unstubAllGlobals()
  await setTestLocale('de')
})

interface MenuItem {
  label: string
  disabled?: boolean
  to?: string
  children?: MenuItem[]
  onSelect?: (event: Event) => void
}

const BLUE_EYES = { id: 89631139, name: 'Blue-Eyes White Dragon', nameDe: 'Blauäugiger w. Drache', type: 'Normal Monster' }
const FUSION = { id: 23995346, name: 'Blue-Eyes Ultimate Dragon', nameDe: null, type: 'Fusion Monster' }

function deckAfterAdd(options: { quantity: number, section?: 'main' | 'extra' | 'side', cardId?: number, warnings?: unknown[] }) {
  const section = options.section ?? 'main'
  const sections: Record<string, unknown[]> = { main: [], extra: [], side: [] }
  sections[section] = [{ catalogCardId: options.cardId ?? BLUE_EYES.id, quantity: options.quantity }]
  return { sections, warnings: options.warnings ?? [], validation: null }
}

function stubFetch(handler: (url: string, options?: { method?: string, body?: unknown, query?: unknown }) => unknown) {
  const fetchMock = vi.fn(async (url: string, options?: { method?: string, body?: unknown, query?: unknown }) => handler(url, options))
  vi.stubGlobal('$fetch', fetchMock)
  return fetchMock
}

function decksResponse(names: string[]) {
  return { items: names.map((name, index) => ({ id: `d${index + 1}`, name })), total: names.length, page: 1, pageSize: 60 }
}

async function mountMenu(card: typeof BLUE_EYES | typeof FUSION | null = BLUE_EYES) {
  const component = await mountSuspended(CardAddToDeckMenu, { props: { card } })
  const menu = component.findComponent(UDropdownMenu)
  // The menu teleports its content, so open it and drive its items directly.
  menu.vm.$emit('update:open', true)
  await flushPromises()
  return { component, items: () => menu.props('items') as MenuItem[], menu }
}

describe('CardAddToDeckMenu', () => {
  it('loads the decks when it opens', async () => {
    const fetchMock = stubFetch(() => decksResponse(['Drachen', 'Magier']))
    const { component, items } = await mountMenu()

    expect(component.text()).toContain('Zum Deck')
    expect(fetchMock).toHaveBeenCalledWith('/api/decks', { query: { pageSize: 60, q: undefined } })
    expect(items().map(item => item.label)).toEqual(['Drachen', 'Magier'])
    expect(items()[0]!.children!.map(item => item.label)).toEqual(['Main Deck', 'Side Deck'])
  })

  it('adds one copy in one step and confirms it with a link to the deck', async () => {
    const fetchMock = stubFetch((url, options) => url === '/api/decks'
      ? decksResponse(['Drachen'])
      : options?.method === 'PUT' ? deckAfterAdd({ quantity: 3 }) : null)
    const { items } = await mountMenu()

    items()[0]!.children![0]!.onSelect!(new Event('select'))
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/decks/d1/cards', {
      method: 'PUT',
      body: { catalogCardId: BLUE_EYES.id, section: 'main', increment: 1 },
    })
    // No read of the deck first: the increment is atomic on the server.
    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain('/api/decks/d1')
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Zu „Drachen“ hinzugefügt',
      description: 'Blauäugiger w. Drache: jetzt 3× im Main Deck.',
      color: 'success',
      actions: [expect.objectContaining({ label: 'Deck öffnen', to: '/decks/d1' })],
    }))
  })

  it('warns about this card\'s copy limit, not about other cards', async () => {
    const warning = (cardId: number, cardName: string) => ({
      code: 'copies_above_max',
      message: `${cardName}: 4 copies`,
      cardId,
      params: { cardId, cardName, copies: 4, maxCopies: 3 },
    })
    stubFetch((url, options) => url === '/api/decks'
      ? decksResponse(['Drachen'])
      : options?.method === 'PUT'
        ? deckAfterAdd({ quantity: 4, warnings: [warning(BLUE_EYES.id, BLUE_EYES.name), warning(1, 'Other Card')] })
        : null)
    const { items } = await mountMenu()

    items()[0]!.children![0]!.onSelect!(new Event('select'))
    await flushPromises()

    const toast = toastAdd.mock.calls[0]![0]
    expect(toast.color).toBe('warning')
    expect(toast.description).toContain('Blauäugiger w. Drache: jetzt 4× im Main Deck.')
    expect(toast.description).toContain('4 Kopien im Deck, höchstens 3 sind üblich.')
    expect(toast.description).not.toContain('Other Card')
  })

  it('shows the translated API error when the deck is gone', async () => {
    stubFetch((url, options) => {
      if (url === '/api/decks') {
        return decksResponse(['Drachen'])
      }
      if (options?.method === 'PUT') {
        throw Object.assign(new Error('Not found'), { data: { statusCode: 404, data: { code: 'deck_not_found' } } })
      }
      return null
    })
    const { items } = await mountMenu()

    items()[0]!.children![0]!.onSelect!(new Event('select'))
    await flushPromises()

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dieses Deck gibt es nicht mehr.', color: 'error' }))
  })

  it('offers only the Extra and Side Deck for an Extra Deck card', async () => {
    const fetchMock = stubFetch((url, options) => url === '/api/decks'
      ? decksResponse(['Drachen'])
      : options?.method === 'PUT' ? deckAfterAdd({ quantity: 1, section: 'extra', cardId: FUSION.id }) : null)
    const { items } = await mountMenu(FUSION)

    expect(items()[0]!.children!.map(item => item.label)).toEqual(['Extra Deck', 'Side Deck'])
    items()[0]!.children![0]!.onSelect!(new Event('select'))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/decks/d1/cards', expect.objectContaining({
      body: { catalogCardId: FUSION.id, section: 'extra', increment: 1 },
    }))
  })

  it('offers to create a deck when there is none', async () => {
    stubFetch(() => decksResponse([]))
    const { items } = await mountMenu()

    expect(items().map(item => item.label)).toEqual(['Noch keine Decks', 'Deck anlegen'])
    expect(items()[1]!.to).toBe('/decks')
  })

  it('offers a retry when the decks can\'t be loaded', async () => {
    let fail = true
    const fetchMock = stubFetch(() => {
      if (fail) {
        throw new Error('offline')
      }
      return decksResponse(['Drachen'])
    })
    const { items } = await mountMenu()

    expect(items().map(item => item.label)).toEqual(['Decks konnten nicht geladen werden', 'Erneut versuchen'])
    fail = false
    const event = new Event('select', { cancelable: true })
    items()[1]!.onSelect!(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(items().map(item => item.label)).toEqual(['Drachen'])
  })

  // More decks than one page (60): a search field reaches every deck.
  it('searches the decks on the server when there are many', async () => {
    const many = Array.from({ length: 60 }, (_, index) => `Deck ${index + 1}`)
    const fetchMock = stubFetch((url, options) => {
      const q = (options?.query as { q?: string } | undefined)?.q
      return q ? decksResponse(['Deck 75']) : { ...decksResponse(many), total: 80 }
    })
    const { menu, items } = await mountMenu()

    expect(menu.props('filter')).toBeTruthy()
    expect(menu.props('ignoreFilter')).toBe(true)
    expect(items()).toHaveLength(60)

    vi.useFakeTimers()
    try {
      menu.vm.$emit('update:searchTerm', 'Deck 75')
      await vi.advanceTimersByTimeAsync(300)
    }
    finally {
      vi.useRealTimers()
    }
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/api/decks', { query: { pageSize: 60, q: 'Deck 75' } })
    expect(items().map(item => item.label)).toEqual(['Deck 75'])
  })

  it('shows no search field for a few decks', async () => {
    stubFetch(() => decksResponse(['Drachen', 'Magier']))
    const { menu } = await mountMenu()

    expect(menu.props('filter')).toBe(false)
  })

  it('is disabled without a card', async () => {
    stubFetch(() => decksResponse([]))
    const component = await mountSuspended(CardAddToDeckMenu, { props: { card: null } })

    expect(component.find('button').attributes('disabled')).toBeDefined()
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    stubFetch(() => decksResponse([]))
    const { component, items } = await mountMenu()

    expect(component.text()).toContain('Add to deck')
    expect(items().map(item => item.label)).toEqual(['No decks yet', 'Create a deck'])
  })
})
