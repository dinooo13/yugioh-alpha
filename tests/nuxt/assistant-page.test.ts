import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import AssistantConversationPage from '~/pages/assistant/[id].vue'
import AssistantIndexPage from '~/pages/assistant/index.vue'
import type {
  AssistantConversationListItem,
  AssistantConversationSummary,
  AssistantStatus,
} from '~~/shared/assistant-chat'
import type { AssistantUIMessage } from '~~/shared/assistant-ui'
import { setTestLocale } from './fixtures/locale'
import { conversationSummary, pendingAction, postedBody, searchConversation, textAnswer, uiStreamResponse } from './fixtures/assistant-ui'

function fakeStatus(overrides: Partial<AssistantStatus> = {}): AssistantStatus {
  return { enabled: true, provider: 'fake', model: 'fake', models: ['fake'], defaultModel: 'fake', chat: true, vision: true, visionModel: null, ...overrides }
}

const DISABLED_STATUS: AssistantStatus = { enabled: false, provider: null, model: null, models: [], defaultModel: null, chat: false, vision: false, visionModel: null }

const state = vi.hoisted(() => ({
  status: null as AssistantStatus | null,
  conversations: { items: [] as AssistantConversationListItem[] },
  query: {} as Record<string, string>,
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
  return () => ({ path: '/assistant/conv-1', params: { id: 'conv-1' }, query: state.query })
})

function findButton(component: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  return component.findAll('button').find((button: DOMWrapper<Element>) => button.text().includes(label))
}

/** `$fetch` answering `GET …/messages` with this conversation, and `extra` for anything else. */
function stubConversation(conversation: AssistantConversationSummary, messages: AssistantUIMessage[], extra: (url: string, options?: { method?: string }) => unknown = () => null) {
  const fetchMock = vi.fn((url: string, options?: { method?: string }) => {
    if (url === '/api/assistant/chat/conv-1/messages') {
      return Promise.resolve({ conversation, messages })
    }
    return Promise.resolve(extra(url, options))
  })
  vi.stubGlobal('$fetch', fetchMock)
  return fetchMock
}

afterEach(async () => {
  await setTestLocale('de')
  vi.unstubAllGlobals()
  state.status = fakeStatus()
  state.conversations = { items: [] }
  state.query = {}
  navigateToMock.mockClear()
  vi.restoreAllMocks()
})

/** Spies on the router's `replace` (dropping `?prompt=`) without navigating. */
function spyOnReplace() {
  return vi.spyOn(useRouter(), 'replace').mockResolvedValue(undefined)
}

state.status = fakeStatus()

describe('assistant chat page', () => {
  it('shows a configuration notice and no thread when the assistant is disabled', async () => {
    state.status = DISABLED_STATUS
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(null)))

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    expect(component.text()).toContain('Assistent nicht verfügbar')
    // A user-facing notice — no operator env var names.
    expect(component.html()).not.toContain('NUXT_')
    expect(component.html()).not.toContain('API_KEY')
    expect(component.find('textarea').exists()).toBe(false)
  })

  it('shows the title as a visible heading and no deck link, even for an old \'Deck: …\' title', async () => {
    stubConversation(conversationSummary({ title: 'Deck: Magier' }), [])

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    const header = component.find('header')
    const heading = header.find('h1')
    expect(heading.text()).toBe('Deck: Magier')
    expect(heading.classes()).not.toContain('sr-only')
    expect(header.find('a[href^="/decks/"]').exists()).toBe(false)
  })

  it('shows the empty-thread hint', async () => {
    stubConversation(conversationSummary(), [])

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    expect(component.text()).toContain('Noch keine Nachrichten')
  })

  it('ignores ?intent= — the composer starts empty', async () => {
    state.query = { intent: 'edit-deck' }
    stubConversation(conversationSummary(), [])
    const streamFetch = vi.fn()
    vi.stubGlobal('fetch', streamFetch)

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    expect((component.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    // Nothing was sent: no stream request.
    expect(streamFetch).not.toHaveBeenCalled()
  })

  it('sends a ?prompt= example once the conversation is loaded, and drops it from the URL', async () => {
    state.query = { prompt: 'Welche Karten habe ich von Blue-Eyes?' }
    stubConversation(conversationSummary(), [])
    const streamFetch = vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a1', 'Testantwort'))))
    vi.stubGlobal('fetch', streamFetch)
    const replaceMock = spyOnReplace()

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()
    await vi.waitFor(() => expect(component.text()).toContain('Testantwort'))

    expect(streamFetch).toHaveBeenCalledTimes(1)
    expect((streamFetch.mock.calls[0] as unknown[])[0]).toBe('/api/assistant/chat/conv-1/stream')
    expect(postedBody(streamFetch)).toMatchObject({
      trigger: 'submit-message',
      message: { role: 'user', parts: [{ type: 'text', text: 'Welche Karten habe ich von Blue-Eyes?' }] },
    })
    expect(replaceMock).toHaveBeenCalledWith({ query: {} })
  })

  it('renders user/assistant messages, a tool chip, and an action card; applying it flips the badge', async () => {
    const fetchMock = stubConversation(conversationSummary(), searchConversation(), (url, options) =>
      url === '/api/assistant/chat/actions/action-1/apply' && options?.method === 'POST'
        ? { action: pendingAction({ status: 'applied', result: { created: 2, merged: 0 } }) }
        : null)

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    const text = component.text()
    expect(text).toContain('suche Dark Magician')
    expect(text).toContain('Sucht im Katalog: Dark Magician')
    expect(text).toContain('1 Ergebnis')
    expect(text).not.toContain('Ergebnis(se)')
    expect(text).toContain('Ich habe 1 Karte gefunden: Dark Magician.')
    expect(text).toContain('1 Karte zum Inventar hinzufügen: Dark Magician x2')
    expect(text).toContain('Wartet auf Bestätigung')
    expect(component.find('[data-testid="assistant-thread"]').exists()).toBe(true)

    const applyButton = findButton(component, 'Übernehmen')
    expect(applyButton).toBeTruthy()
    await applyButton!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/chat/actions/action-1/apply', expect.objectContaining({ method: 'POST' }))
    expect(component.text()).toContain('Übernommen')
    expect(component.text()).not.toContain('Wartet auf Bestätigung')
  })

  it('names the deck in tool chips instead of its id, and opens a failed tool to its error', async () => {
    stubConversation(conversationSummary(), deckToolMessages())

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    const text = component.text()
    expect(text).toContain('Prüft ein Deck: Magier')
    expect(text).not.toContain('deck-1')
    // An unresolvable deck (deleted, or not the user's) gets no detail at all.
    expect(text).toContain('Liest ein Deck')
    expect(text).not.toContain('gone-deck')
    expect(text).toContain('Fehlgeschlagen')
    expect(text).toContain('Durchsucht dein Inventar: Blue-Eyes')
    expect(text).toContain('mindestens 2 Ergebnisse')

    const failed = component.find('[data-testid="assistant-tool"][data-outcome="error"] button')
    await failed.trigger('click')
    await flushPromises()
    expect(component.find('[data-testid="assistant-tool"][data-outcome="error"]').text()).toContain('Deck not found')
  })

  it('renders the thread, chips and composer in English', async () => {
    await setTestLocale('en')
    stubConversation(conversationSummary({ title: 'Magier prüfen' }), deckToolMessages())

    const component = await mountSuspended(AssistantConversationPage)
    await flushPromises()

    const text = component.text()
    expect(text).toContain('Checking a deck: Magier')
    expect(text).toContain('Reading a deck')
    expect(text).toContain('Failed')
    expect(text).toContain('Searching your inventory: Blue-Eyes')
    expect(text).toContain('at least 2 results')
    expect(component.find('textarea').attributes('placeholder')).toBe('Message the assistant…')
    expect(findButton(component, 'Send')).toBeTruthy()
    expect(findButton(component, 'New conversation')).toBeTruthy()
  })

  it('shows the English empty thread', async () => {
    await setTestLocale('en')
    stubConversation(conversationSummary(), [])

    const page = await mountSuspended(AssistantConversationPage)
    await flushPromises()
    expect(page.text()).toContain('No messages yet — tell the assistant what it should do for you.')
  })

  it('offers the model picker only when the server lists more than one model', async () => {
    stubConversation(conversationSummary(), [])
    const single = await mountSuspended(AssistantConversationPage)
    await flushPromises()
    expect(single.find('[data-testid="assistant-model-select"]').exists()).toBe(false)

    state.status = fakeStatus({ models: ['mimo-v2.6-pro', 'glm-5.3-flash'], defaultModel: 'mimo-v2.6-pro', model: 'mimo-v2.6-pro' })
    const multiple = await mountSuspended(AssistantConversationPage)
    await flushPromises()
    const select = multiple.find('[data-testid="assistant-model-select"]')
    expect(select.exists()).toBe(true)
    expect(select.attributes('aria-label')).toBe('Modell')
    expect(select.text()).toContain('MiMo v2.6 Pro')
  })
})

function deckToolMessages(): AssistantUIMessage[] {
  return [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'prüfe mein Deck' }] },
    {
      id: 'm2',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'tool-validate_deck', toolCallId: 'call-1', state: 'output-available', input: { deckId: 'deck-1' }, output: { result: { legal: true, issues: [] }, deckName: 'Magier' } },
        { type: 'tool-get_deck', toolCallId: 'call-2', state: 'output-error', input: { id: 'gone-deck' }, errorText: 'Deck not found' },
        { type: 'tool-search_inventory', toolCallId: 'call-3', state: 'output-available', input: { query: 'Blue-Eyes' }, output: { result: { items: [{ name: 'A' }, { name: 'B' }], truncated: true, total: 30 } } },
        { type: 'step-start' },
        { type: 'text', text: 'Dein Deck ist legal.', state: 'done' },
      ],
    },
  ]
}

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
    expect(navigateToMock).toHaveBeenCalledWith('/assistant/new-conv')
  })

  it('redirects straight to the newest conversation instead of showing the empty state when one already exists', async () => {
    state.conversations = { items: [{ id: 'existing-conv', title: 'Bestehend', updatedAt: '2025-01-01T00:00:00.000Z' }] }
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(null)))

    await mountSuspended(AssistantIndexPage)
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/assistant/existing-conv')
  })

  it('shows the "nicht verfügbar" notice without env var names when the assistant is disabled', async () => {
    state.status = DISABLED_STATUS
    vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(null)))

    const component = await mountSuspended(AssistantIndexPage)
    await flushPromises()

    expect(component.text()).toContain('Assistent nicht verfügbar')
    expect(component.html()).not.toContain('NUXT_')
    expect(findButton(component, 'Neue Unterhaltung')).toBeFalsy()
  })

  it('ignores old ?deckId= / ?intent= links and goes to the newest conversation', async () => {
    state.conversations = { items: [{ id: 'existing-conv', title: 'Bestehend', updatedAt: '2025-01-01T00:00:00.000Z' }] }
    for (const query of [{ deckId: 'deck-1' }, { intent: 'new-deck' }] as Array<Record<string, string>>) {
      state.query = query
      navigateToMock.mockClear()
      const fetchMock = vi.fn((_url: string, _options?: { method?: string }) => Promise.resolve(null))
      vi.stubGlobal('$fetch', fetchMock)

      const component = await mountSuspended(AssistantIndexPage)
      await flushPromises()

      expect(navigateToMock, JSON.stringify(query)).toHaveBeenCalledWith('/assistant/existing-conv')
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
      expect(component.text()).not.toContain('Unterhaltung wird vorbereitet')
    }
  })

})
