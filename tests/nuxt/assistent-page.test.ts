import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import AssistantConversationPage from '~/pages/assistent/[id].vue'
import AssistantIndexPage from '~/pages/assistent/index.vue'
import AssistantComposer from '~/components/assistant/Composer.vue'
import type {
  AssistantActionView,
  AssistantConversationListItem,
  AssistantConversationSummary,
  AssistantMessageView,
} from '~~/shared/assistant-chat'
import type { DeckAssistantStatus } from '~~/shared/deck-assistant'

const state = vi.hoisted(() => ({
  status: { enabled: true, provider: 'fake', model: 'fake', chat: true, vision: true, visionModel: null } as DeckAssistantStatus,
  conversations: { items: [] as AssistantConversationListItem[] },
}))

const navigateToMock = vi.hoisted(() => vi.fn())

mockNuxtImport('navigateTo', () => navigateToMock)

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url

    if (resolvedUrl === '/api/assistant/status') {
      return { data: ref(state.status), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/assistant/chat') {
      return { data: ref(state.conversations), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/assistent/conv-1', params: { id: 'conv-1' }, query: {} })
})

function findButton(component: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  return component.findAll('button').find((button: DOMWrapper<Element>) => button.text().includes(label))
}

function conversation(overrides: Partial<AssistantConversationSummary> = {}): AssistantConversationSummary {
  return {
    id: 'conv-1',
    title: 'Testkonversation',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:05:00.000Z',
    ...overrides,
  }
}

function pendingAction(overrides: Partial<AssistantActionView> = {}): AssistantActionView {
  return {
    id: 'action-1',
    messageId: 'm2',
    kind: 'add_to_inventory',
    summary: '1 Karte(n) zum Inventar hinzufügen: Dark Magician x2',
    payload: { items: [{ catalogCardId: 46986414, quantity: 2, collectionId: null, language: 'en', condition: 'near_mint', edition: 'unlimited', printingId: null }] },
    status: 'pending',
    ...overrides,
  }
}

function buildMessages(): AssistantMessageView[] {
  return [
    { id: 'm1', role: 'user', content: 'suche Dark Magician', createdAt: '2025-01-01T00:00:01.000Z' },
    {
      id: 'm2',
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-1', name: 'search_catalog', arguments: { query: 'Dark Magician' } }],
      createdAt: '2025-01-01T00:00:02.000Z',
    },
    {
      id: 'm3',
      role: 'tool',
      content: JSON.stringify([{ id: 46986414, name: 'Dark Magician' }]),
      toolCallId: 'call-1',
      toolName: 'search_catalog',
      createdAt: '2025-01-01T00:00:03.000Z',
    },
    { id: 'm4', role: 'assistant', content: 'Ich habe 1 Karte gefunden: Dark Magician.', createdAt: '2025-01-01T00:00:04.000Z' },
  ]
}

afterEach(() => {
  vi.unstubAllGlobals()
  state.status = { enabled: true, provider: 'fake', model: 'fake', chat: true, vision: true, visionModel: null }
  state.conversations = { items: [] }
  navigateToMock.mockClear()
})

describe('assistant chat page', () => {
  it('shows a configuration notice and no thread when the assistant is disabled', async () => {
    state.status = { enabled: false, provider: null, model: null, chat: false, vision: false, visionModel: null }
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(null)))

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    expect(component.text()).toContain('Der KI-Assistent ist nicht konfiguriert.')
    expect(component.find('textarea').exists()).toBe(false)
  })

  it('renders user/assistant messages, a tool activity chip, and an action card; applying it flips the badge', async () => {
    const fetchMock = vi.fn((url: string, options?: { method?: string }) => {
      if (url === '/api/assistant/chat/conv-1' && (!options || options.method === undefined)) {
        return Promise.resolve({ conversation: conversation(), messages: buildMessages(), actions: [pendingAction()] })
      }
      if (url === '/api/assistant/chat/actions/action-1/apply' && options?.method === 'POST') {
        return Promise.resolve({ action: pendingAction({ status: 'applied', result: { created: 2, merged: 0 } }) })
      }
      return Promise.resolve(null)
    })
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    const text = component.text()
    expect(text).toContain('suche Dark Magician')
    expect(text).toContain('Sucht im Katalog: Dark Magician')
    expect(text).toContain('1 Ergebnis(se)')
    expect(text).toContain('Ich habe 1 Karte gefunden: Dark Magician.')
    expect(text).toContain('1 Karte(n) zum Inventar hinzufügen: Dark Magician x2')
    expect(text).toContain('Wartet auf Bestätigung')

    const applyButton = findButton(component, 'Übernehmen')
    expect(applyButton).toBeTruthy()
    await applyButton!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/chat/actions/action-1/apply', expect.objectContaining({ method: 'POST' }))
    expect(component.text()).toContain('Übernommen')
    expect(component.text()).not.toContain('Wartet auf Bestätigung')
  })

  it('sending re-pins the thread to the bottom, and the thread stays mounted through the end of the turn', async () => {
    let detailMessages = buildMessages()
    let detailActions: AssistantActionView[] = []
    vi.stubGlobal('$fetch', vi.fn((url: string) => {
      if (url === '/api/assistant/chat/conv-1') {
        return Promise.resolve({ conversation: conversation(), messages: detailMessages, actions: detailActions })
      }
      return Promise.resolve(null)
    }))

    const encoder = new TextEncoder()
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
    })
    const push = (event: string, data: unknown) =>
      streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(stream, { status: 200 }))))

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    const threadElement = component.find('[data-testid="assistant-thread"]').element as HTMLElement
    expect(threadElement).toBeTruthy()

    // happy-dom has no layout — give the thread container scroll metrics so
    // "scrolled up" and "at the bottom" mean something.
    let scrollTop = 0
    Object.defineProperty(threadElement, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(threadElement, 'clientHeight', { configurable: true, get: () => 400 })
    Object.defineProperty(threadElement, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, 600))
      },
    })

    // The user was at the bottom, then scrolled up to reread something —
    // that unpins the thread.
    threadElement.scrollTop = 600
    threadElement.dispatchEvent(new Event('scroll'))
    threadElement.scrollTop = 0
    threadElement.dispatchEvent(new Event('scroll'))

    component.findComponent(AssistantComposer).vm.$emit('send', { text: 'füge 2 hinzu', images: [] })
    await flushPromises()

    // Sending re-pinned it: the view jumped to the end of the thread.
    expect(scrollTop).toBe(600)

    push('text_delta', { text: 'Ich schlage vor, 2 Karten hinzuzufügen.' })
    push('action_proposed', { action: pendingAction({ messageId: 'm6' }) })
    await flushPromises()
    expect(component.text()).toContain('Wartet auf Bestätigung')

    detailMessages = [
      ...buildMessages(),
      { id: 'm5', role: 'user', content: 'füge 2 hinzu', createdAt: '2025-01-01T00:00:05.000Z' },
      { id: 'm6', role: 'assistant', content: 'Ich schlage vor, 2 Karten hinzuzufügen.', createdAt: '2025-01-01T00:00:06.000Z' },
    ]
    detailActions = [pendingAction({ messageId: 'm6' })]
    push('message_end', { message: detailMessages.at(-1) })
    streamController.close()
    await flushPromises()

    // The end-of-turn re-sync happened in the background: same thread
    // element (not torn down and remounted at scrollTop 0), still showing
    // the action card.
    expect(component.find('[data-testid="assistant-thread"]').element).toBe(threadElement)
    expect(component.text()).toContain('Wartet auf Bestätigung')
    expect(component.find('textarea').exists()).toBe(true)
  })
})

describe('assistant empty-state page', () => {
  it('shows a primary "Neue Unterhaltung" button alongside the example prompts when there are no conversations yet', async () => {
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(null)))

    const component = await mountSuspended(AssistantIndexPage)
    await flushPromises()

    expect(findButton(component, 'Neue Unterhaltung')).toBeTruthy()
    expect(component.text()).toContain('Welche Karten habe ich von Blue-Eyes?')
  })

  it('starts an empty conversation and navigates to it, without sending any message', async () => {
    const fetchMock = vi.fn((url: string, options?: { method?: string }) => {
      if (url === '/api/assistant/chat' && options?.method === 'POST') {
        return Promise.resolve({ id: 'new-conv' })
      }
      return Promise.resolve(null)
    })
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(AssistantIndexPage)
    await flushPromises()

    const createButton = findButton(component, 'Neue Unterhaltung')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/chat', expect.objectContaining({ method: 'POST' }))
    expect(navigateToMock).toHaveBeenCalledWith('/assistent/new-conv')
  })

  it('redirects straight to the newest conversation instead of showing the empty state when one already exists', async () => {
    state.conversations = { items: [{ id: 'existing-conv', title: 'Bestehend', updatedAt: '2025-01-01T00:00:00.000Z' }] }
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(null)))

    await mountSuspended(AssistantIndexPage)
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/assistent/existing-conv')
  })
})
