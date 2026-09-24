// The assistant's thread on the AI SDK's chat client (ChatThread.vue +
// useAssistantChat, docs/adr/0020-assistant-on-the-ai-sdk.md): what a turn
// sends, how streamed parts render (text, chips, proposals), the German
// plurals (#70), the error texts, retry, cancel, regenerate, the model
// picker, card names in chips and collapsed reasoning (#128), and the title
// request after a turn (#129). The stream endpoint is a stubbed `fetch` answering with the UI
// message stream protocol; `GET …/messages` is a stubbed `$fetch`.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatThread from '~/components/assistant/ChatThread.vue'
import AssistantComposer from '~/components/assistant/Composer.vue'
import type { AssistantUIMessage } from '~~/shared/assistant-ui'
import { isEndedTurnStored } from '~/composables/useAssistantChat'
import { assistantChatErrorCode } from '~/utils/assistant-chat-error'
import { ASSISTANT_MODEL_COOKIE } from '~/utils/assistant-models'
import { setTestLocale } from './fixtures/locale'
import {
  controlledUiStream,
  conversationSummary,
  httpErrorResponse,
  pendingAction,
  postedBody,
  searchConversation,
  textAnswer,
  uiStreamResponse,
} from './fixtures/assistant-ui'

type Component = Awaited<ReturnType<typeof mountSuspended>>

function findButton(component: Component, label: string) {
  return component.findAll('button').find((button: DOMWrapper<Element>) => button.text().includes(label))
}

function stubMessages(messages: AssistantUIMessage[] | (() => AssistantUIMessage[]), extra: (url: string, options?: { method?: string }) => unknown = () => null) {
  const fetchMock = vi.fn((url: string, options?: { method?: string }) => {
    if (url === '/api/assistant/chat/conv-1/messages') {
      return Promise.resolve({ conversation: conversationSummary(), messages: typeof messages === 'function' ? messages() : messages })
    }
    return Promise.resolve(extra(url, options))
  })
  vi.stubGlobal('$fetch', fetchMock)
  return fetchMock
}

async function mountThread(props: Record<string, unknown> = {}) {
  const component = await mountSuspended(ChatThread, { props: { conversationId: 'conv-1', ...props } })
  await flushPromises()
  return component
}

async function sendText(component: Component, text: string) {
  component.findComponent(AssistantComposer).vm.$emit('send', { text, files: [] })
  await flushPromises()
}

function toolPart(name: string, input: Record<string, unknown>, result: unknown): AssistantUIMessage['parts'][number] {
  return { type: `tool-${name}`, toolCallId: `call-${name}`, state: 'output-available', input, output: { result } } as AssistantUIMessage['parts'][number]
}

afterEach(async () => {
  await setTestLocale('de')
  vi.unstubAllGlobals()
  useCookie(ASSISTANT_MODEL_COOKIE).value = null
})

describe('AssistantChatThread: a turn', () => {
  it('sends only the new message and its trigger, and renders the streamed text, chip and proposal in order', async () => {
    stubMessages(searchConversation())
    const stream = controlledUiStream()
    const fetchMock = vi.fn(() => Promise.resolve(stream.response))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread()
    const thread = component.find('[data-testid="assistant-thread"]').element

    await sendText(component, 'füge 2 hinzu')
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/assistant/chat/conv-1/stream')
    const body = postedBody(fetchMock)
    expect(body).toMatchObject({ trigger: 'submit-message', message: { role: 'user', parts: [{ type: 'text', text: 'füge 2 hinzu' }] } })
    // The history comes from the database: no client history in the body.
    expect(body).not.toHaveProperty('messages')
    expect(body).not.toHaveProperty('model')
    expect(component.text()).toContain('füge 2 hinzu')
    // Sending: the button stops the turn now.
    expect(findButton(component, 'Abbrechen')).toBeTruthy()

    stream.push({ type: 'start', messageId: 'a2' })
    stream.push({ type: 'start-step' })
    stream.push({ type: 'tool-input-available', toolCallId: 'c9', toolName: 'add_to_inventory', input: { items: [{ catalogCardId: 46986414, quantity: 2 }] } })
    await flushPromises()
    expect(component.find('[data-outcome="running"]').text()).toContain('Schlägt vor, Karten ins Inventar aufzunehmen')

    stream.push({ type: 'tool-output-available', toolCallId: 'c9', output: { result: { status: 'pending_confirmation' } } })
    stream.push({ type: 'data-action', id: 'action-2', data: pendingAction({ id: 'action-2', messageId: 'a2' }) })
    stream.push({ type: 'finish-step' })
    stream.push({ type: 'start-step' })
    stream.push({ type: 'text-start', id: 't' })
    stream.push({ type: 'text-delta', id: 't', delta: 'Ich habe einen Vorschlag angelegt.' })
    stream.push({ type: 'text-end', id: 't' })
    stream.push({ type: 'finish-step' })
    stream.push({ type: 'finish', finishReason: 'stop' })
    stream.close()
    await flushPromises()
    await vi.waitFor(() => expect(findButton(component, 'Senden')).toBeTruthy())

    const answer = component.findAll('article').at(-1)!
    const text = answer.text()
    expect(text.indexOf('Vorschlag angelegt')).toBeLessThan(text.indexOf('Wartet auf Bestätigung'))
    expect(text.indexOf('Wartet auf Bestätigung')).toBeLessThan(text.indexOf('Ich habe einen Vorschlag angelegt.'))
    // The thread stayed mounted through the turn.
    expect(component.find('[data-testid="assistant-thread"]').element).toBe(thread)
    expect(component.emitted('turnEnd')).toHaveLength(1)
  })

  it('sends photos as file parts and shows them above the message', async () => {
    stubMessages([])
    const fetchMock = vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a1', 'Auf dem Bild sehe ich: Dark Magician.'))))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread()
    component.findComponent(AssistantComposer).vm.$emit('send', { text: '', files: [{ mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,AAA' }] })
    await flushPromises()
    await vi.waitFor(() => expect(component.text()).toContain('Auf dem Bild sehe ich'))

    expect(postedBody(fetchMock).message).toMatchObject({ parts: [{ type: 'file', mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,AAA' }] })
    expect(component.find('img[src="data:image/jpeg;base64,AAA"]').attributes('alt')).toBe('Foto 1')
  })

  it('shows a stored photo as its "Foto n" label (the bytes are never stored)', async () => {
    stubMessages([{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Was ist das?' }, { type: 'data-image', data: { index: 1 } }, { type: 'data-image', data: { index: 2 } }] }])
    const component = await mountThread()
    expect(component.text()).toContain('Foto 1')
    expect(component.text()).toContain('Foto 2')
    expect(component.text()).toContain('Was ist das?')
  })

  it('shows the model\'s reasoning collapsed, apart from the answer', async () => {
    stubMessages([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hallo' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'reasoning', text: 'Der Nutzer grüßt.', state: 'done' }, { type: 'text', text: 'Hallo!', state: 'done' }] },
    ])
    const component = await mountThread()
    const reasoning = component.find('[data-slot="trigger"]')
    expect(reasoning.exists()).toBe(true)
    expect(reasoning.attributes('aria-expanded')).toBe('false')
    expect(component.text()).toContain('Hallo!')
  })
})

describe('AssistantChatThread: tool chips and German plurals (#70)', () => {
  it.each([
    [[{ id: 1 }], 'Sucht im Katalog: Dark — 1 Ergebnis'],
    [[{ id: 1 }, { id: 2 }], 'Sucht im Katalog: Dark — 2 Ergebnisse'],
    [{ items: [{ id: 1 }, { id: 2 }], truncated: true }, 'Sucht im Katalog: Dark — mindestens 2 Ergebnisse'],
  ])('counts %j as "%s"', async (result, expected) => {
    stubMessages([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'suche Dark' }] },
      { id: 'm2', role: 'assistant', parts: [toolPart('search_catalog', { query: 'Dark' }, result)] },
    ])
    const component = await mountThread()
    expect(component.find('[data-testid="assistant-tool"]').text().replace(/\s*—\s*/, ' — ')).toBe(expected)
  })

  it('writes proposal summaries with real plurals', async () => {
    const add = (count: number) => pendingAction({
      id: `add-${count}`,
      payload: { items: Array.from({ length: count }, (_, index) => ({ catalogCardId: index, name: `Karte${index + 1}`, quantity: 1 })) },
    })
    stubMessages([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'x' }] },
      {
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'data-action', id: 'add-1', data: add(1) },
          { type: 'data-action', id: 'add-2', data: add(2) },
          {
            type: 'data-action',
            id: 'upd',
            data: pendingAction({
              id: 'upd',
              kind: 'update_deck_cards',
              payload: { deckId: 'd', deckName: 'Magier', changes: [1, 2, 3].map(id => ({ catalogCardId: id, section: 'main', quantity: 1, name: `K${id}` })) },
            }),
          },
        ],
      },
    ])
    const text = (await mountThread()).text()
    expect(text).toContain('1 Karte zum Inventar hinzufügen: Karte1 x1')
    expect(text).toContain('2 Karten zum Inventar hinzufügen: Karte1 x1, Karte2 x1')
    expect(text).toContain('3 Kartenänderungen an Deck "Magier"')
  })
})

describe('AssistantChatThread: errors, retry and cancel', () => {
  it.each([
    ['an HTTP error before the turn (JSON body with data.code)', () => Promise.resolve(httpErrorResponse(409, 'turn_in_progress')), 'Es läuft bereits eine Anfrage.'],
    ['the stream\'s error chunk (the code as its text)', () => Promise.resolve(uiStreamResponse([{ type: 'start', messageId: 'a1' }, { type: 'error', errorText: 'assistant_busy' }])), 'Der KI-Assistent ist ausgelastet, bitte später erneut versuchen.'],
    ['a lost connection', () => Promise.reject(new TypeError('Failed to fetch')), 'Die Verbindung wurde unterbrochen. Bitte versuche es erneut.'],
    ['an unknown error', () => Promise.resolve(uiStreamResponse([{ type: 'start', messageId: 'a1' }, { type: 'error', errorText: 'Something odd' }])), 'Es ist ein unerwarteter Fehler aufgetreten.'],
  ])('shows %s in the interface language', async (_label, answer, expected) => {
    stubMessages([])
    vi.stubGlobal('fetch', vi.fn(answer))

    const component = await mountThread()
    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(component.find('[role="alert"]').exists()).toBe(true))
    expect(component.find('[role="alert"]').text()).toBe(expected)
    expect(findButton(component, 'Erneut versuchen')).toBeTruthy()
  })

  it('retry sends a message the server never got again, and regenerates after a stream error', async () => {
    stubMessages([])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(httpErrorResponse(503, 'assistant_not_configured'))
      .mockResolvedValueOnce(uiStreamResponse([{ type: 'start', messageId: 'a1' }, { type: 'error', errorText: 'assistant_unreachable' }]))
      .mockResolvedValueOnce(uiStreamResponse(textAnswer('a2', 'Jetzt klappt es.')))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread()
    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(findButton(component, 'Erneut versuchen')).toBeTruthy())

    await findButton(component, 'Erneut versuchen')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(postedBody(fetchMock, 1)).toMatchObject({ trigger: 'submit-message', message: { parts: [{ type: 'text', text: 'Hallo' }] } })
    // Sent once more, not twice in the thread.
    await vi.waitFor(() => expect(findButton(component, 'Erneut versuchen')).toBeTruthy())
    expect(component.findAll('article').filter(article => article.text().includes('Hallo'))).toHaveLength(1)

    await findButton(component, 'Erneut versuchen')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(component.text()).toContain('Jetzt klappt es.'))
    expect(postedBody(fetchMock, 2)).toMatchObject({ trigger: 'regenerate-message' })
    expect(postedBody(fetchMock, 2)).not.toHaveProperty('message')
    expect(component.find('[role="alert"]').exists()).toBe(false)
  })

  it('a message typed after an error is sent, not retried', async () => {
    stubMessages([])
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(httpErrorResponse(503, 'assistant_not_configured'))))
    const component = await mountThread()
    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(findButton(component, 'Erneut versuchen')).toBeTruthy())

    await component.find('textarea').setValue('Etwas anderes')
    expect(findButton(component, 'Erneut versuchen')).toBeFalsy()
    expect(findButton(component, 'Senden')).toBeTruthy()
  })

  it('"Abbrechen" stops the stream and shows the stored partial answer with "(abgebrochen)"', async () => {
    const partial: AssistantUIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Erzähl' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Es war einmal … (abgebrochen)', state: 'done' }] },
    ]
    let stored: AssistantUIMessage[] = []
    const fetchMock = stubMessages(() => stored)
    const stream = controlledUiStream()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => {
      init.signal.addEventListener('abort', () => {
        stored = partial
      })
      return Promise.resolve(stream.response)
    }))

    const component = await mountThread()
    await sendText(component, 'Erzähl')
    stream.push({ type: 'start', messageId: 'a1' })
    stream.push({ type: 'start-step' })
    stream.push({ type: 'text-start', id: 't' })
    stream.push({ type: 'text-delta', id: 't', delta: 'Es war einmal' })
    await flushPromises()
    await vi.waitFor(() => expect(component.text()).toContain('Es war einmal'))

    await findButton(component, 'Abbrechen')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(component.text()).toContain('Es war einmal … (abgebrochen)'), { timeout: 3000 })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/assistant/chat/conv-1/messages').length).toBeGreaterThanOrEqual(2)
    await vi.waitFor(() => expect(findButton(component, 'Senden')).toBeTruthy())
  })

  it('knows when a cancelled turn is stored', () => {
    const user: AssistantUIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'x' }] }
    const streamed: AssistantUIMessage = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Teil' }] }
    const stored: AssistantUIMessage = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Teil … (abgebrochen)' }] }
    expect(isEndedTurnStored([user, streamed], [user, streamed], true)).toBe(false)
    expect(isEndedTurnStored([user, streamed], [user], true)).toBe(false)
    expect(isEndedTurnStored([user, streamed], [user, stored], true)).toBe(true)
    // Stopped before the answer started: any stored answer will do.
    expect(isEndedTurnStored([user], [user, stored], true)).toBe(true)
    // A turn that timed out: stored once no tool call is open any more.
    const open: AssistantUIMessage = { id: 'a', role: 'assistant', parts: [{ type: 'tool-validate_deck', toolCallId: 'c', state: 'input-available', input: {} }] }
    const closed: AssistantUIMessage = { id: 'a', role: 'assistant', parts: [{ type: 'tool-validate_deck', toolCallId: 'c', state: 'output-error', input: {}, errorText: 'cancelled' }] }
    expect(isEndedTurnStored([user, open], [user, open], false)).toBe(false)
    expect(isEndedTurnStored([user, open], [user, closed], false)).toBe(true)
  })

  it('fetches a turn that ended with a tool call still running again, so its chip stops loading', async () => {
    const closed: AssistantUIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Baue ein Deck' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'tool-validate_deck', toolCallId: 'c1', state: 'output-error', input: {}, errorText: 'The turn ended before this tool call finished.' },
          { type: 'text', text: 'Die Anfrage hat zu lange gedauert.', state: 'done' },
        ],
      },
    ]
    let stored: AssistantUIMessage[] = []
    stubMessages(() => stored)
    vi.stubGlobal('fetch', vi.fn(() => {
      stored = closed
      return Promise.resolve(uiStreamResponse([
        { type: 'start', messageId: 'a1' },
        { type: 'start-step' },
        { type: 'tool-input-available', toolCallId: 'c1', toolName: 'validate_deck', input: {} },
        { type: 'text-start', id: 'n' },
        { type: 'text-delta', id: 'n', delta: 'Die Anfrage hat zu lange gedauert.' },
        { type: 'text-end', id: 'n' },
        { type: 'finish', finishReason: 'other' },
      ]))
    }))

    const component = await mountThread()
    await sendText(component, 'Baue ein Deck')
    await vi.waitFor(() => expect(component.find('[data-outcome="error"]').exists()).toBe(true), { timeout: 3000 })
    expect(component.find('[data-outcome="running"]').exists()).toBe(false)
  })

  it('reads the error code from an HTTP body or a stream error', () => {
    expect(assistantChatErrorCode(new Error(JSON.stringify({ statusCode: 413, data: { code: 'request_too_large' } })))).toBe('request_too_large')
    expect(assistantChatErrorCode(new Error('assistant_misconfigured'))).toBe('assistant_misconfigured')
    expect(assistantChatErrorCode(new Error('Failed to fetch the chat response.'))).toBeUndefined()
    expect(assistantChatErrorCode('nope')).toBeUndefined()
  })
})

describe('AssistantChatThread: regenerate and the model picker', () => {
  it('offers "Antwort neu erzeugen" on the last answer while its proposals are pending, not after one was applied', async () => {
    stubMessages(searchConversation(), (url, options) =>
      url === '/api/assistant/chat/actions/action-1/apply' && options?.method === 'POST'
        ? { action: pendingAction({ status: 'applied' }) }
        : null)
    const fetchMock = vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a3', 'Neue Antwort.'))))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread()
    expect(findButton(component, 'Antwort neu erzeugen')).toBeTruthy()

    await findButton(component, 'Übernehmen')!.trigger('click')
    await flushPromises()
    expect(findButton(component, 'Antwort neu erzeugen')).toBeFalsy()
  })

  it('regenerates the last answer', async () => {
    stubMessages(searchConversation())
    const fetchMock = vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a3', 'Neue Antwort.'))))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread()
    await findButton(component, 'Antwort neu erzeugen')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(component.text()).toContain('Neue Antwort.'))
    expect(postedBody(fetchMock)).toMatchObject({ trigger: 'regenerate-message' })
    expect(component.text()).not.toContain('Ich habe 1 Karte gefunden')
  })

  it('sends the picked model, remembers it on this device, and names the model under each answer', async () => {
    stubMessages(searchConversation())
    const fetchMock = vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a3', 'Schnell.', { model: 'glm-5.3-flash' }))))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread({ models: ['mimo-v2.6-pro', 'glm-5.3-flash', 'deepseek-v4.1-flash'], defaultModel: 'mimo-v2.6-pro' })
    expect(component.find('[data-testid="assistant-answer-model"]').text()).toBe('MiMo v2.6 Pro')

    component.findComponent(AssistantComposer).vm.$emit('update:model', 'glm-5.3-flash')
    await flushPromises()
    expect(useCookie(ASSISTANT_MODEL_COOKIE).value).toBe('glm-5.3-flash')

    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(component.text()).toContain('Schnell.'))
    expect(postedBody(fetchMock)).toMatchObject({ model: 'glm-5.3-flash' })
    expect(component.findAll('[data-testid="assistant-answer-model"]').map(label => label.text())).toEqual(['MiMo v2.6 Pro', 'GLM 5.3 Flash'])
  })

  it('falls back to the default model when the remembered one is no longer offered', async () => {
    useCookie(ASSISTANT_MODEL_COOKIE).value = 'retired-model'
    stubMessages([])
    const fetchMock = vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a1', 'OK.'))))
    vi.stubGlobal('fetch', fetchMock)

    const component = await mountThread({ models: ['mimo-v2.6-pro', 'glm-5.3-flash'], defaultModel: 'mimo-v2.6-pro' })
    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(component.text()).toContain('OK.'))
    expect(postedBody(fetchMock)).toMatchObject({ model: 'mimo-v2.6-pro' })
  })

  it('shows no picker and no model note with a single model', async () => {
    stubMessages(searchConversation())
    const component = await mountThread({ models: ['mimo-v2.6-pro'], defaultModel: 'mimo-v2.6-pro' })
    expect(component.find('[data-testid="assistant-model-select"]').exists()).toBe(false)
    expect(component.find('[data-testid="assistant-answer-model"]').exists()).toBe(false)
  })
})

describe('AssistantChatThread: card names in chips and collapsed reasoning (#128)', () => {
  const DARK_MAGICIAN = { id: 46986414, name: 'Dark Magician', nameDe: 'Dunkler Magier', type: 'Normal Monster' }

  function getCardConversation(): AssistantUIMessage[] {
    return [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'zeige karte 46986414' }] },
      { id: 'm2', role: 'assistant', parts: [toolPart('get_card', { id: 46986414 }, DARK_MAGICIAN), { type: 'text', text: 'Kartendetails gelesen.', state: 'done' }] },
    ]
  }

  it('names a stored get_card call by the card\'s name in the card language', async () => {
    stubMessages(getCardConversation())
    const german = await mountThread()
    expect(german.find('[data-testid="assistant-tool"]').text()).toContain('Liest Kartendetails: Dunkler Magier')
    german.unmount()

    await setTestLocale('en')
    const english = await mountThread()
    expect(english.find('[data-testid="assistant-tool"]').text()).toContain('Reading card details: Dark Magician')
  })

  it('shows the id while get_card runs, and the name once its result is there', async () => {
    stubMessages([])
    const stream = controlledUiStream()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(stream.response)))
    const component = await mountThread()
    await sendText(component, 'zeige karte 46986414')

    stream.push({ type: 'start', messageId: 'a1' })
    stream.push({ type: 'start-step' })
    stream.push({ type: 'tool-input-available', toolCallId: 'c1', toolName: 'get_card', input: { id: 46986414 } })
    await flushPromises()
    await vi.waitFor(() => expect(component.find('[data-outcome="running"]').exists()).toBe(true))
    expect(component.find('[data-testid="assistant-tool"]').text()).toContain('Liest Kartendetails: 46986414')

    stream.push({ type: 'tool-output-available', toolCallId: 'c1', output: { result: DARK_MAGICIAN } })
    await flushPromises()
    await vi.waitFor(() => expect(component.find('[data-outcome="ok"]').exists()).toBe(true))
    expect(component.find('[data-testid="assistant-tool"]').text()).toContain('Liest Kartendetails: Dunkler Magier')
    stream.push({ type: 'finish-step' })
    stream.push({ type: 'finish', finishReason: 'stop' })
    stream.close()
    await flushPromises()
  })

  it('keeps streaming reasoning collapsed with the shimmer; the user opens it and it stays open', async () => {
    stubMessages([])
    const first = controlledUiStream()
    const second = controlledUiStream()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response))
    const component = await mountThread()
    const trigger = () => component.findAll('[data-testid="assistant-reasoning"] [data-slot="trigger"]').at(-1)!
    // Nuxt UI's own label (its locale comes from <UApp> in app.vue, which a
    // mounted component lacks, so it is the English one here).
    const THINKING = /Denkt nach…|Thinking…/

    await sendText(component, 'denk nach')
    first.push({ type: 'start', messageId: 'a1' })
    first.push({ type: 'start-step' })
    first.push({ type: 'reasoning-start', id: 'r1' })
    first.push({ type: 'reasoning-delta', id: 'r1', delta: 'Ich überlege kurz.' })
    await flushPromises()
    await vi.waitFor(() => expect(component.find('[data-testid="assistant-reasoning"]').exists()).toBe(true))
    await flushPromises()
    expect(trigger().attributes('aria-expanded')).toBe('false')
    expect(trigger().text()).toMatch(THINKING)

    await trigger().trigger('click')
    await flushPromises()
    expect(trigger().attributes('aria-expanded')).toBe('true')

    first.push({ type: 'reasoning-delta', id: 'r1', delta: ' Noch etwas.' })
    first.push({ type: 'reasoning-end', id: 'r1' })
    first.push({ type: 'text-start', id: 't1' })
    first.push({ type: 'text-delta', id: 't1', delta: 'Fertig überlegt.' })
    first.push({ type: 'text-end', id: 't1' })
    first.push({ type: 'finish-step' })
    first.push({ type: 'finish', finishReason: 'stop' })
    first.close()
    await flushPromises()
    await vi.waitFor(() => expect(findButton(component, 'Senden')).toBeTruthy())
    // No auto-close once it's done (Nuxt UI's default closes it after 500 ms).
    await new Promise(resolve => setTimeout(resolve, 600))
    await flushPromises()
    expect(trigger().attributes('aria-expanded')).toBe('true')
    expect(trigger().text()).not.toMatch(THINKING)

    // The next turn's reasoning starts collapsed again.
    await sendText(component, 'denk nach')
    second.push({ type: 'start', messageId: 'a2' })
    second.push({ type: 'start-step' })
    second.push({ type: 'reasoning-start', id: 'r2' })
    second.push({ type: 'reasoning-delta', id: 'r2', delta: 'Ich überlege noch mal.' })
    await flushPromises()
    await vi.waitFor(() => expect(component.findAll('[data-testid="assistant-reasoning"]')).toHaveLength(2))
    await flushPromises()
    expect(trigger().attributes('aria-expanded')).toBe('false')
    expect(trigger().text()).toMatch(THINKING)
    second.push({ type: 'reasoning-end', id: 'r2' })
    second.push({ type: 'finish', finishReason: 'stop' })
    second.close()
    await flushPromises()
  })

  it('doesn\'t shimmer for reasoning a turn that ended left "streaming"', async () => {
    stubMessages([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hallo' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'reasoning', text: 'Der Nutzer grüßt.', state: 'streaming' }] },
    ])
    const component = await mountThread()
    const trigger = component.find('[data-testid="assistant-reasoning"] [data-slot="trigger"]')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.text()).not.toMatch(/Denkt nach…|Thinking…/)
  })
})

describe('AssistantChatThread: the title request after a turn (#129)', () => {
  function titleCalls(fetchMock: ReturnType<typeof stubMessages>) {
    return fetchMock.mock.calls.filter(([url]) => url === '/api/assistant/chat/conv-1/title')
  }

  it('asks the server to name the conversation after a completed turn, and reports a new title', async () => {
    const fetchMock = stubMessages([], url => url === '/api/assistant/chat/conv-1/title'
      ? { generated: true, conversation: conversationSummary({ title: 'Thema: Hallo' }) }
      : null)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a1', 'Hallo!')))))

    const component = await mountThread()
    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(component.emitted('titleChange')).toHaveLength(1))
    expect(titleCalls(fetchMock)).toEqual([['/api/assistant/chat/conv-1/title', { method: 'POST' }]])
    expect(component.emitted('turnEnd')).toHaveLength(1)
    // The thread's summary follows (the page's header reads it).
    expect(component.emitted('loaded')!.at(-1)).toEqual([conversationSummary({ title: 'Thema: Hallo' })])
  })

  it('reports nothing when the title stayed', async () => {
    const fetchMock = stubMessages([], url => url === '/api/assistant/chat/conv-1/title'
      ? { generated: false, conversation: conversationSummary() }
      : null)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a1', 'Hallo!')))))

    const component = await mountThread()
    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(titleCalls(fetchMock)).toHaveLength(1))
    await flushPromises()
    expect(component.emitted('titleChange')).toBeUndefined()
  })

  it.each([
    ['an HTTP error', () => Promise.resolve(httpErrorResponse(503, 'assistant_not_configured'))],
    ['a stream error', () => Promise.resolve(uiStreamResponse([{ type: 'start', messageId: 'a1' }, { type: 'error', errorText: 'assistant_busy' }]))],
  ])('doesn\'t ask after a turn that ended with %s', async (_label, answer) => {
    const fetchMock = stubMessages([])
    vi.stubGlobal('fetch', vi.fn(answer))
    const component = await mountThread()
    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(component.emitted('turnEnd')).toHaveLength(1))
    await flushPromises()
    expect(titleCalls(fetchMock)).toHaveLength(0)
  })

  it('doesn\'t ask after a cancelled turn', async () => {
    const fetchMock = stubMessages([])
    const stream = controlledUiStream()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(stream.response)))
    const component = await mountThread()
    await sendText(component, 'Erzähl')
    stream.push({ type: 'start', messageId: 'a1' })
    stream.push({ type: 'start-step' })
    stream.push({ type: 'text-start', id: 't' })
    stream.push({ type: 'text-delta', id: 't', delta: 'Es war einmal' })
    await flushPromises()
    await vi.waitFor(() => expect(component.text()).toContain('Es war einmal'))

    await findButton(component, 'Abbrechen')!.trigger('click')
    await vi.waitFor(() => expect(component.emitted('turnEnd')).toHaveLength(1), { timeout: 4000 })
    await flushPromises()
    expect(titleCalls(fetchMock)).toHaveLength(0)
  })

  it('doesn\'t ask once the user has sent more than three messages', async () => {
    const earlier: AssistantUIMessage[] = [1, 2, 3].flatMap(index => [
      { id: `u${index}`, role: 'user' as const, parts: [{ type: 'text' as const, text: `Frage ${index}` }] },
      { id: `a${index}`, role: 'assistant' as const, parts: [{ type: 'text' as const, text: `Antwort ${index}`, state: 'done' as const }] },
    ])
    const fetchMock = stubMessages(earlier)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a4', 'Antwort 4')))))
    const component = await mountThread()
    await sendText(component, 'Frage 4')
    await vi.waitFor(() => expect(component.emitted('turnEnd')).toHaveLength(1))
    await flushPromises()
    expect(titleCalls(fetchMock)).toHaveLength(0)
  })

  it('shows no error when the title request fails', async () => {
    const fetchMock = stubMessages([], url => url === '/api/assistant/chat/conv-1/title'
      ? Promise.reject(new Error('500'))
      : null)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(uiStreamResponse(textAnswer('a1', 'Hallo!')))))

    const component = await mountThread()
    await sendText(component, 'Hallo')
    await vi.waitFor(() => expect(titleCalls(fetchMock)).toHaveLength(1))
    await flushPromises()
    expect(component.find('[role="alert"]').exists()).toBe(false)
    expect(component.emitted('titleChange')).toBeUndefined()
    expect(findButton(component, 'Senden')).toBeTruthy()
  })
})
