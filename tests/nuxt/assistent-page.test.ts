import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import AssistantConversationPage from '~/pages/assistent/[id].vue'
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
})
