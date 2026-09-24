import { defineComponent, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTestLocale } from './fixtures/locale'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type {
  AssistantActionView,
  AssistantConversationSummary,
  AssistantMessageView,
} from '~~/shared/assistant-chat'

// Covers review finding #15's biggest gap: nothing exercised the *live*
// stream path through useAssistantThread — exactly where findings #1-#3
// (action cards invisible live, chips/pre-tool text vanishing on
// message_end, wrong streaming order) lived — plus #5's cancel wiring and
// the 409/503 error surfaces (error codes, rendered in the interface
// language — ADR 0014).

/** A `ReadableStream` we can push individual SSE event chunks into (and
 * error, to simulate an aborted fetch) whenever the test wants to, instead
 * of handing the whole body to the reader up front — lets each assertion
 * below observe the composable's state at an exact point mid-stream. */
function createDrivableStream() {
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
  })
  return {
    stream,
    push: (chunk: string) => controllerRef.enqueue(encoder.encode(chunk)),
    close: () => controllerRef.close(),
    error: (reason: unknown) => controllerRef.error(reason),
  }
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function conversation(overrides: Partial<AssistantConversationSummary> = {}): AssistantConversationSummary {
  return {
    id: 'conv-1',
    title: 'Testkonversation',
    deck: null,
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
    payload: { items: [{ catalogCardId: 46986414, quantity: 2 }] },
    status: 'pending',
    ...overrides,
  }
}

function persistedMessages(): AssistantMessageView[] {
  return [
    { id: 'm1', role: 'user', content: 'füge Dark Magician hinzu', createdAt: '2025-01-01T00:00:01.000Z' },
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
    {
      id: 'm4',
      role: 'assistant',
      content: 'Ich schlage vor, die Karte hinzuzufügen.',
      createdAt: '2025-01-01T00:00:04.000Z',
    },
  ]
}

function mountThread() {
  const Host = defineComponent({
    setup() {
      return useAssistantThread(ref('conv-1'))
    },
    template: '<div />',
  })
  return mountSuspended(Host)
}

interface TimelineItemLike { type: string, [key: string]: unknown }

function types(component: Awaited<ReturnType<typeof mountThread>>): string[] {
  return (component.vm.timeline as TimelineItemLike[]).map(item => item.type)
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await setTestLocale('de')
})

describe('useAssistantThread', () => {
  it('streams a tool round then text then an action card in arrival order, and re-syncs from the server on message_end', async () => {
    const drivable = createDrivableStream()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/assistant/chat/conv-1/messages') {
        return Promise.resolve(new Response(drivable.stream, { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const dollarFetchMock = vi.fn((url: string) => {
      if (url === '/api/assistant/chat/conv-1') {
        return Promise.resolve({ conversation: conversation(), messages: persistedMessages(), actions: [pendingAction()] })
      }
      return Promise.reject(new Error(`unexpected $fetch ${url}`))
    })
    vi.stubGlobal('$fetch', dollarFetchMock)

    const component = await mountThread()
    const vm = component.vm

    const sendPromise = vm.send({ text: 'füge Dark Magician hinzu', images: [] })
    await flushPromises()

    drivable.push(sseEvent('message_start', { userMessageId: 'm1' }))
    await flushPromises()

    drivable.push(sseEvent('tool_call', { id: 'call-1', name: 'search_catalog', arguments: { query: 'Dark Magician' } }))
    await flushPromises()
    expect(types(component)).toEqual(['message', 'activity'])
    expect(vm.timeline.at(-1)).toMatchObject({ type: 'activity', status: 'running', call: { name: 'search_catalog', arguments: { query: 'Dark Magician' } } })

    drivable.push(sseEvent('tool_result', { id: 'call-1', ok: true, outcome: { count: 1 } }))
    await flushPromises()
    expect(vm.timeline.at(-1)).toMatchObject({ type: 'activity', status: 'ok', outcome: { count: 1 } })
    const streamedChip = vm.timeline.at(-1)

    drivable.push(sseEvent('text_delta', { text: 'Ich schlage vor, ' }))
    await flushPromises()
    drivable.push(sseEvent('text_delta', { text: 'die Karte hinzuzufügen.' }))
    await flushPromises()

    // The answer text arrives *after* the tool round here — the live
    // timeline must reflect that arrival order (finding #3), not always
    // render one text bubble above every chip.
    expect(types(component).slice(-2)).toEqual(['activity', 'message'])
    expect(vm.timeline.at(-1)).toMatchObject({ content: 'Ich schlage vor, die Karte hinzuzufügen.' })

    drivable.push(sseEvent('action_proposed', { action: pendingAction() }))
    await flushPromises()

    // The action card shows up the instant it's proposed — no waiting for
    // the turn to finish (finding #1).
    expect(types(component).at(-1)).toBe('action')
    expect(vm.isStreaming).toBe(true)

    drivable.push(sseEvent('message_end', {
      message: { id: 'm4', role: 'assistant', content: 'Ich schlage vor, die Karte hinzuzufügen.', createdAt: '2025-01-01T00:00:04.000Z' },
    }))
    drivable.close()
    await sendPromise
    await flushPromises()

    // message_end re-synced from the server instead of appending the
    // client's own copy of the final message — the persisted timeline also
    // carries the intermediate assistant/tool rows a live-only rendering
    // never had (finding #2).
    expect(dollarFetchMock).toHaveBeenCalledWith('/api/assistant/chat/conv-1')
    expect(vm.isStreaming).toBe(false)
    // The persisted action is attached to the intermediate assistant row
    // that made the tool call (messageId 'm2'), so it renders right after
    // that row's tool chip — ahead of the final confirmation text (m4).
    expect(types(component)).toEqual(['message', 'activity', 'action', 'message'])
    expect(vm.timeline.some(item => item.type === 'action' && item.action.status === 'pending')).toBe(true)

    // Reload parity: the persisted chip carries exactly what the live one
    // did, so ToolActivity renders the same text either way.
    const reloadedChip = vm.timeline.find(item => item.type === 'activity')
    const { key: _streamedKey, ...streamed } = streamedChip as TimelineItemLike
    const { key: _reloadedKey, ...reloaded } = reloadedChip as TimelineItemLike
    expect(reloaded).toEqual(streamed)
  })

  it('message_end re-syncs in the background without toggling isLoading and swaps streaming items atomically', async () => {
    const drivable = createDrivableStream()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(drivable.stream, { status: 200 }))))

    // The initial mount doesn't call load() (the page does), so every
    // $fetch here is message_end's re-sync — held open until the test
    // decides to resolve it.
    let resolveDetail: ((value: unknown) => void) | undefined
    const dollarFetchMock = vi.fn((url: string) => {
      if (url === '/api/assistant/chat/conv-1') {
        return new Promise((resolve) => {
          resolveDetail = resolve
        })
      }
      return Promise.reject(new Error(`unexpected $fetch ${url}`))
    })
    vi.stubGlobal('$fetch', dollarFetchMock)

    const component = await mountThread()
    const vm = component.vm
    // `isLoading` starts out true until the page's first load() — a
    // background re-sync must never flip it back on after that.
    vm.isLoading = false
    const loadingStates: boolean[] = []
    const stopWatching = watch(() => vm.isLoading, value => loadingStates.push(value))

    const sendPromise = vm.send({ text: 'füge Dark Magician hinzu', images: [] })
    await flushPromises()

    drivable.push(sseEvent('tool_call', { id: 'call-1', name: 'search_catalog', arguments: { query: 'Dark Magician' } }))
    drivable.push(sseEvent('tool_result', { id: 'call-1', ok: true, outcome: { count: 1 } }))
    drivable.push(sseEvent('text_delta', { text: 'Ich schlage vor, die Karte hinzuzufügen.' }))
    drivable.push(sseEvent('action_proposed', { action: pendingAction() }))
    drivable.push(sseEvent('message_end', {
      message: { id: 'm4', role: 'assistant', content: 'Ich schlage vor, die Karte hinzuzufügen.', createdAt: '2025-01-01T00:00:04.000Z' },
    }))
    drivable.close()
    await flushPromises()

    // The re-sync is in flight: the streamed rows are still on screen (no
    // shrink-then-regrow) and the thread was never hidden behind isLoading.
    expect(dollarFetchMock).toHaveBeenCalledWith('/api/assistant/chat/conv-1')
    expect(types(component)).toEqual(['message', 'activity', 'message', 'action'])
    expect(vm.timeline.at(-1)).toMatchObject({ type: 'action', key: 'streaming-action-action-1' })
    expect(vm.isLoading).toBe(false)

    resolveDetail!({ conversation: conversation(), messages: persistedMessages(), actions: [pendingAction()] })
    await sendPromise
    await flushPromises()
    stopWatching()

    expect(types(component)).toEqual(['message', 'activity', 'action', 'message'])
    expect(vm.timeline.some(item => item.key.startsWith('streaming-'))).toBe(false)
    expect(loadingStates).not.toContain(true)
    expect(vm.isLoading).toBe(false)
    expect(vm.loadError).toBe('')
    expect(vm.isStreaming).toBe(false)
  })

  it('a failed background re-sync surfaces as sendError and keeps the thread', async () => {
    const drivable = createDrivableStream()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(drivable.stream, { status: 200 }))))
    vi.stubGlobal('$fetch', vi.fn(() => Promise.reject(new Error('network down'))))

    const component = await mountThread()
    const vm = component.vm
    vm.isLoading = false

    const sendPromise = vm.send({ text: 'hallo', images: [] })
    await flushPromises()

    drivable.push(sseEvent('text_delta', { text: 'Hallo!' }))
    drivable.push(sseEvent('message_end', {
      message: { id: 'm2', role: 'assistant', content: 'Hallo!', createdAt: '2025-01-01T00:00:02.000Z' },
    }))
    drivable.close()
    await sendPromise
    await flushPromises()

    expect(vm.sendError).toBe('Die Unterhaltung konnte nicht aktualisiert werden.')
    expect(vm.loadError).toBe('')
    expect(vm.isLoading).toBe(false)
    expect(vm.timeline.length).toBeGreaterThan(0)
    expect(vm.isStreaming).toBe(false)
  })

  it('cancel() aborts the fetch and reloads once the persisted (partial) turn is available', async () => {
    const drivable = createDrivableStream()
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      capturedSignal?.addEventListener('abort', () => {
        drivable.error(new DOMException('The user aborted a request.', 'AbortError'))
      })
      return Promise.resolve(new Response(drivable.stream, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const dollarFetchMock = vi.fn(() =>
      Promise.resolve({ conversation: conversation(), messages: persistedMessages(), actions: [] }))
    vi.stubGlobal('$fetch', dollarFetchMock)

    const component = await mountThread()
    const vm = component.vm
    vm.isLoading = false
    const loadingStates: boolean[] = []
    const stopWatching = watch(() => vm.isLoading, value => loadingStates.push(value))

    const sendPromise = vm.send({ text: 'hallo', images: [] })
    await flushPromises()

    vm.cancel()
    expect(vm.isCancelling).toBe(true)
    expect(capturedSignal?.aborted).toBe(true)

    await sendPromise
    await flushPromises()
    stopWatching()

    expect(dollarFetchMock).toHaveBeenCalledWith('/api/assistant/chat/conv-1')
    // Re-synced in the background — the thread was never hidden.
    expect(loadingStates).not.toContain(true)
    expect(vm.isLoading).toBe(false)
    expect(types(component)).toEqual(['message', 'activity', 'message'])
    expect(vm.isStreaming).toBe(false)
    expect(vm.isCancelling).toBe(false)
    expect(vm.sendError).toBe('')
  })

  it('surfaces a 409 (turn already in flight) from its error code', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ statusCode: 409, statusMessage: 'A turn is already in progress', data: { code: 'turn_in_progress' } }), { status: 409 }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread()
    await component.vm.send({ text: 'hallo', images: [] })

    expect(component.vm.sendError).toBe('Es läuft bereits eine Anfrage.')
    expect(component.vm.isStreaming).toBe(false)
  })

  it('surfaces a 503 (assistant not configured) from its error code', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ statusCode: 503, statusMessage: 'The assistant is not configured', data: { code: 'assistant_not_configured' } }), { status: 503 }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread()
    await component.vm.send({ text: 'hallo', images: [] })

    expect(component.vm.sendError).toBe('KI-Assistent ist nicht konfiguriert.')
    expect(component.vm.isStreaming).toBe(false)
  })

  it('never shows a raw statusMessage: an error without a known code gets the generic text', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ statusCode: 400, statusMessage: 'text must be a string' }), { status: 400 }),
    )))

    const component = await mountThread()
    await component.vm.send({ text: 'hallo', images: [] })

    expect(component.vm.sendError).toBe('Es ist ein unerwarteter Fehler aufgetreten.')
  })

  it('shows an SSE error event by its code, in the interface language', async () => {
    const drivable = createDrivableStream()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(drivable.stream, { status: 200 }))))

    const component = await mountThread()
    const sendPromise = component.vm.send({ text: 'hallo', images: [] })
    await flushPromises()
    drivable.push(sseEvent('error', { code: 'assistant_unreachable', message: 'The assistant is currently unreachable' }))
    drivable.close()
    await sendPromise
    expect(component.vm.sendError).toBe('Der KI-Assistent ist derzeit nicht erreichbar.')

    await setTestLocale('en')
    const english = createDrivableStream()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(english.stream, { status: 200 }))))
    const englishSend = component.vm.send({ text: 'hello', images: [] })
    await flushPromises()
    english.push(sseEvent('error', { code: 'unexpected', message: 'boom' }))
    english.close()
    await englishSend
    expect(component.vm.sendError).toBe('An unexpected error occurred.')
  })
})
