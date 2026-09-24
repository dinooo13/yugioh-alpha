// The chat assistant's model layer (server/utils/deck-assistant-model.ts):
// provider/status resolution, the OpenAI-compatible streaming `chat()`
// transport, and the deterministic fake used by tests and E2E. Moved here
// from the former deck-assistant.test.ts when the one-shot `generate()`
// path was removed (docs/adr/0011-deck-assistance-in-chat.md).

import { describe, expect, it, vi } from 'vitest'
import {
  createFakeModel,
  createOpenAiCompatibleModel,
  getDeckAssistantStatus,
  useDeckAssistantModel,
} from '../../server/utils/deck-assistant-model'
import type {
  ChatMessage,
  ChatModelInput,
} from '../../server/utils/deck-assistant-model'
import { DEFAULT_ASSISTANT_TIMEOUT_MS } from '../../server/utils/assistant-limits'

describe('assistant status/config resolution', () => {
  it('resolves to fake, openai-by-key, openai-by-custom-base-url, or disabled', () => {
    const config = useRuntimeConfig().assistant as {
      provider: string
      baseUrl: string
      apiKey: string
      model: string
      visionModel: string
    }
    const original = { ...config }

    try {
      config.provider = 'fake'
      expect(getDeckAssistantStatus()).toEqual({
        enabled: true,
        provider: 'fake',
        model: 'fake',
        baseUrl: null,
        chat: true,
        vision: true,
        visionModel: null,
      })
      expect(useDeckAssistantModel()?.id).toBe('fake')

      config.provider = ''
      config.baseUrl = ''
      config.apiKey = 'sk-test-key'
      config.model = ''
      expect(getDeckAssistantStatus()).toEqual({
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'api.openai.com',
        chat: true,
        vision: true,
        visionModel: null,
      })
      expect(useDeckAssistantModel()?.id).toBe('gpt-4o-mini')

      // A configured vision model is reported separately.
      config.visionModel = 'gpt-4o'
      expect(getDeckAssistantStatus().visionModel).toBe('gpt-4o')
      config.visionModel = ''

      // No key, but a base URL explicitly pointed away from the default
      // (e.g. a keyless local Ollama server) still resolves to 'openai'.
      config.apiKey = ''
      config.baseUrl = 'http://localhost:11434/v1'
      expect(getDeckAssistantStatus()).toEqual({
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'localhost:11434',
        chat: true,
        vision: true,
        visionModel: null,
      })

      config.baseUrl = ''
      expect(getDeckAssistantStatus()).toEqual({
        enabled: false,
        provider: null,
        model: null,
        baseUrl: null,
        chat: false,
        vision: false,
        visionModel: null,
      })
      expect(useDeckAssistantModel()).toBeNull()
    }
    finally {
      Object.assign(config, original)
    }
  })
})

describe('chat()', () => {
  interface RecordedInit { headers: Record<string, string>, body: string }
  interface RecordedCall { url: string, init: RecordedInit }

  function sseLine(payload: unknown): string {
    return `data: ${JSON.stringify(payload)}\n\n`
  }

  function sseFetchReturning(chunks: string[], status = 200): { fetch: typeof fetch, calls: RecordedCall[] } {
    const calls: RecordedCall[] = []
    const fetchImpl = (async (url: string, init: RecordedInit) => {
      calls.push({ url, init })
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk))
          }
          controller.close()
        },
      })
      return { status, body: stream } as unknown as Response
    }) as unknown as typeof fetch
    return { fetch: fetchImpl, calls }
  }

  function errorFetchReturning(status: number): { fetch: typeof fetch } {
    const fetchImpl = (async () => ({ status, body: null }) as unknown as Response) as unknown as typeof fetch
    return { fetch: fetchImpl }
  }

  function collectHandlers() {
    const textDeltas: string[] = []
    let toolCallDeltas = 0
    return {
      handlers: {
        onTextDelta: (text: string) => textDeltas.push(text),
        onToolCallDelta: () => { toolCallDeltas += 1 },
      },
      textDeltas,
      get toolCallDeltas() { return toolCallDeltas },
    }
  }

  const chatBaseInput: ChatModelInput = {
    sessionId: 'conversation-42',
    system: 'system prompt',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hallo' }] }],
    tools: [],
  }

  it('accumulates streamed text deltas and reports finishReason "stop"', async () => {
    const { fetch: fetchImpl } = sseFetchReturning([
      sseLine({ choices: [{ delta: { content: 'Hallo' } }] }),
      sseLine({ choices: [{ delta: { content: ' Welt' } }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })
    const { handlers, textDeltas } = collectHandlers()

    const result = await model.chat(chatBaseInput, handlers)

    expect(result).toEqual({ text: 'Hallo Welt', toolCalls: [], finishReason: 'stop' })
    expect(textDeltas).toEqual(['Hallo', ' Welt'])
  })

  it('tolerates a "data:" line split across chunk boundaries', async () => {
    const wholeLine = sseLine({ choices: [{ delta: { content: 'Hallo' } }] })
    const splitAt = Math.floor(wholeLine.length / 2)
    const { fetch: fetchImpl } = sseFetchReturning([
      wholeLine.slice(0, splitAt),
      wholeLine.slice(splitAt),
      'data: [DONE]\n\n',
    ])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })
    const { handlers } = collectHandlers()

    const result = await model.chat(chatBaseInput, handlers)

    expect(result.text).toBe('Hallo')
  })

  it('accumulates tool-call argument deltas split across events, keyed by index', async () => {
    const { fetch: fetchImpl } = sseFetchReturning([
      sseLine({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_catalog', arguments: '' } }] } }] }),
      sseLine({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }] }),
      sseLine({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Dark Magician"}' } }] } }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })
    const bundle = collectHandlers()

    const result = await model.chat(chatBaseInput, bundle.handlers)

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'search_catalog', arguments: '{"query":"Dark Magician"}' }])
    expect(bundle.toolCallDeltas).toBeGreaterThan(0)
  })

  it('ignores a malformed "data:" line and keeps reading the stream', async () => {
    const { fetch: fetchImpl } = sseFetchReturning([
      'data: not json at all\n\n',
      sseLine({ choices: [{ delta: { content: 'Hallo' } }] }),
      'data: [DONE]\n\n',
    ])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })
    const { handlers } = collectHandlers()

    const result = await model.chat(chatBaseInput, handlers)

    expect(result.text).toBe('Hallo')
  })

  it('joins multiple "data:" lines of one event with \\n before parsing, per the SSE spec', async () => {
    // A provider that pretty-prints or otherwise chunks one event's JSON
    // across several `data:` lines must have them joined with `\n` before
    // parsing — each line here carries a substring of one JSON document.
    const multiLineEvent = 'data: {"choices":\ndata: [{"delta":{"content":"Hallo"}}]}\n\n'
    const { fetch: fetchImpl } = sseFetchReturning([multiLineEvent, 'data: [DONE]\n\n'])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })
    const { handlers } = collectHandlers()

    const result = await model.chat(chatBaseInput, handlers)

    expect(result.text).toBe('Hallo')
  })

  it('maps a mid-stream read error (dropped connection) to the "unreachable" 502, not a raw error', async () => {
    const fetchImpl = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseLine({ choices: [{ delta: { content: 'Hal' } }] })))
          controller.error(new Error('connection reset'))
        },
      })
      return { status: 200, body: stream } as unknown as Response
    }) as unknown as typeof fetch
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.chat(chatBaseInput, collectHandlers().handlers)).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'assistant_unreachable' },
    })
  })

  it('sends x-opencode-session (the conversation id), a User-Agent header, and accept: text/event-stream', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://opencode.ai/zen/go/v1', apiKey: 'go-key', model: 'glm-5.3-flash', fetch: fetchImpl })

    await model.chat(chatBaseInput, collectHandlers().handlers)

    expect(calls[0]!.init.headers['x-opencode-session']).toBe('conversation-42')
    expect(calls[0]!.init.headers['user-agent']).toMatch(/^yugioh-alpha\//)
    expect(calls[0]!.init.headers.accept).toBe('text/event-stream')
    expect(calls[0]!.init.headers.authorization).toBe('Bearer go-key')
  })

  it('sends stream: true, the system + conversation messages, and reasoning_effort when configured', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', reasoningEffort: 'low', fetch: fetchImpl })

    await model.chat(chatBaseInput, collectHandlers().handlers)

    const body = JSON.parse(calls[0]!.init.body)
    expect(body.stream).toBe(true)
    expect(body.reasoning_effort).toBe('low')
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: [{ type: 'text', text: 'Hallo' }] },
    ])
  })

  it('includes tools and tool_choice "auto" only when tools are given', async () => {
    const toolDef = { type: 'function' as const, function: { name: 'search_catalog', description: 'x', parameters: { type: 'object' } } }
    const { fetch: fetchImpl, calls } = sseFetchReturning(
      [sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'],
      200,
    )
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await model.chat({ ...chatBaseInput, tools: [toolDef] }, collectHandlers().handlers)
    await model.chat(chatBaseInput, collectHandlers().handlers)

    const withTools = JSON.parse(calls[0]!.init.body)
    expect(withTools.tools).toEqual([toolDef])
    expect(withTools.tool_choice).toBe('auto')

    const withoutTools = JSON.parse(calls[1]!.init.body)
    expect(withoutTools.tools).toBeUndefined()
    expect(withoutTools.tool_choice).toBeUndefined()
  })

  it('uses the configured model for a turn without images', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', visionModel: 'gpt-4o', fetch: fetchImpl })

    await model.chat(chatBaseInput, collectHandlers().handlers)

    expect(JSON.parse(calls[0]!.init.body).model).toBe('gpt-4o-mini')
  })

  it('uses the configured visionModel for a turn that includes an image', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', visionModel: 'gpt-4o', fetch: fetchImpl })

    const imageInput: ChatModelInput = {
      ...chatBaseInput,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Was ist das?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } }] }],
    }
    await model.chat(imageInput, collectHandlers().handlers)

    expect(JSON.parse(calls[0]!.init.body).model).toBe('gpt-4o')
  })

  it('falls back to the configured model for an image turn when no visionModel is set', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    const imageInput: ChatModelInput = {
      ...chatBaseInput,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } }] }],
    }
    await model.chat(imageInput, collectHandlers().handlers)

    expect(JSON.parse(calls[0]!.init.body).model).toBe('gpt-4o-mini')
  })

  it('an explicit input.model override wins over the configured vision model', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', visionModel: 'gpt-4o', fetch: fetchImpl })

    await model.chat({ ...chatBaseInput, model: 'custom-model' }, collectHandlers().handlers)

    expect(JSON.parse(calls[0]!.init.body).model).toBe('custom-model')
  })

  it('maps 401/403 to a 503 configuration error', async () => {
    const { fetch: fetchImpl } = errorFetchReturning(401)
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-bad', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.chat(chatBaseInput, collectHandlers().handlers)).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'assistant_misconfigured' },
    })
  })

  it('maps 429 to a 503 "ausgelastet" error', async () => {
    const { fetch: fetchImpl } = errorFetchReturning(429)
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.chat(chatBaseInput, collectHandlers().handlers)).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'assistant_busy' },
    })
  })

  it('maps a generic 500 and a network error to a 502 "nicht erreichbar" error', async () => {
    const { fetch: fetchImpl } = errorFetchReturning(500)
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.chat(chatBaseInput, collectHandlers().handlers)).rejects.toMatchObject({ statusCode: 502 })

    const networkFailingFetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const networkModel = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: networkFailingFetch })

    await expect(networkModel.chat(chatBaseInput, collectHandlers().handlers)).rejects.toMatchObject({ statusCode: 502 })
  })

  // Transport cases formerly covered via the one-shot generate() — same
  // request plumbing, now exercised through chat().
  it('omits the Authorization header when the api key is empty (keyless local servers)', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })])
    const model = createOpenAiCompatibleModel({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3', fetch: fetchImpl })

    await model.chat(chatBaseInput, collectHandlers().handlers)

    expect(calls[0]!.init.headers.authorization).toBeUndefined()
  })

  it('sends the API key as a Bearer token when one is configured', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await model.chat(chatBaseInput, collectHandlers().handlers)

    expect(calls[0]!.init.headers.authorization).toBe('Bearer sk-test')
  })

  it('strips a trailing slash from the base URL', async () => {
    const { fetch: fetchImpl, calls } = sseFetchReturning([sseLine({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })])
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://openrouter.ai/api/v1/', apiKey: 'sk-test', model: 'openai/gpt-4o-mini', fetch: fetchImpl })

    await model.chat(chatBaseInput, collectHandlers().handlers)

    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('maps a timeout (AbortError from its own request timer) to a 502', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = ((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })) as unknown as typeof fetch

      const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

      const pending = expect(model.chat(chatBaseInput, collectHandlers().handlers)).rejects.toMatchObject({
        statusCode: 502,
        data: { code: 'assistant_unreachable' },
      })
      await vi.advanceTimersByTimeAsync(DEFAULT_ASSISTANT_TIMEOUT_MS)
      await pending
    }
    finally {
      vi.useRealTimers()
    }
  })
})

describe('fake model chat()', () => {
  function userText(text: string): ChatMessage {
    return { role: 'user', content: [{ type: 'text', text }] }
  }
  function userTextWithImage(text: string): ChatMessage {
    return {
      role: 'user',
      content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: 'data:image/png;base64,xyz' } }],
    }
  }
  function assistantToolCallMessage(): ChatMessage {
    return { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_catalog', arguments: '{}' } }] }
  }
  function toolResultMessage(content: unknown): ChatMessage {
    return { role: 'tool', tool_call_id: 'call-1', content: JSON.stringify(content) }
  }
  function noopHandlers() {
    return { onTextDelta: () => {}, onToolCallDelta: () => {} }
  }

  it('emits a search_catalog tool call for a "suche" message', async () => {
    const model = createFakeModel()
    const result = await model.chat({ sessionId: 's', system: 'sys', messages: [userText('suche Dark Magician')], tools: [] }, noopHandlers())

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]!.name).toBe('search_catalog')
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({ query: 'Dark Magician' })
  })

  it('answers with the found-card count after a search_catalog tool result', async () => {
    const model = createFakeModel()
    const messages: ChatMessage[] = [
      userText('suche Dark Magician'),
      assistantToolCallMessage(),
      toolResultMessage([{ id: 46986414, name: 'Dark Magician' }]),
    ]

    const result = await model.chat({ sessionId: 's', system: 'sys', messages, tools: [] }, noopHandlers())

    expect(result.finishReason).toBe('stop')
    expect(result.toolCalls).toEqual([])
    expect(result.text).toContain('1')
    expect(result.text).toContain('Dark Magician')
  })

  it('emits an add_to_inventory tool call using the first card from an earlier search result', async () => {
    const model = createFakeModel()
    const messages: ChatMessage[] = [
      userText('suche Dark Magician'),
      assistantToolCallMessage(),
      toolResultMessage([{ id: 46986414, name: 'Dark Magician' }]),
      userText('füge 2 hinzu'),
    ]

    const result = await model.chat({ sessionId: 's', system: 'sys', messages, tools: [] }, noopHandlers())

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls[0]!.name).toBe('add_to_inventory')
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({ items: [{ catalogCardId: 46986414, quantity: 2 }] })
  })

  it('also takes the English "add" as an add intent', async () => {
    const model = createFakeModel()
    const messages: ChatMessage[] = [
      userText('suche Dark Magician'),
      assistantToolCallMessage(),
      toolResultMessage([{ id: 46986414, name: 'Dark Magician' }]),
      userText('add 3 of them'),
    ]

    const result = await model.chat({ sessionId: 's', system: 'sys', messages, tools: [] }, noopHandlers())

    expect(result.toolCalls[0]!.name).toBe('add_to_inventory')
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({ items: [{ catalogCardId: 46986414, quantity: 3 }] })
  })

  it('answers with a confirmation after the add_to_inventory tool result', async () => {
    const model = createFakeModel()
    const messages: ChatMessage[] = [
      userText('füge 2 hinzu'),
      assistantToolCallMessage(),
      toolResultMessage({ status: 'pending_confirmation' }),
    ]

    const result = await model.chat({ sessionId: 's', system: 'sys', messages, tools: [] }, noopHandlers())

    expect(result).toEqual({ text: 'Ich habe einen Vorschlag angelegt.', toolCalls: [], finishReason: 'stop' })
  })

  it('identifies a card from an image and follows up with a search_catalog call', async () => {
    const model = createFakeModel()
    const result = await model.chat({ sessionId: 's', system: 'sys', messages: [userTextWithImage('Was ist das?')], tools: [] }, noopHandlers())

    expect(result.text).toBe('Auf dem Bild sehe ich: Dark Magician.')
    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls[0]!.name).toBe('search_catalog')
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({ query: 'Dark Magician' })
  })

  it('echoes the message text otherwise', async () => {
    const model = createFakeModel()
    const result = await model.chat({ sessionId: 's', system: 'sys', messages: [userText('Hallo!')], tools: [] }, noopHandlers())

    expect(result).toEqual({ text: 'Testantwort: Hallo!', toolCalls: [], finishReason: 'stop' })
  })

  it('does not treat "versuche"/"untersuche" as a search intent — word boundaries only', async () => {
    const model = createFakeModel()
    const result = await model.chat({ sessionId: 's', system: 'sys', messages: [userText('ich versuche das Deck zu bauen')], tools: [] }, noopHandlers())

    // No search intent detected: falls through to the plain echo, not a
    // search_catalog tool call.
    expect(result.toolCalls).toEqual([])
    expect(result.text).toBe('Testantwort: ich versuche das Deck zu bauen')
  })

  it('falls back to the last few words (not the whole sentence) when the search keyword can\'t be isolated', async () => {
    const model = createFakeModel()
    // "such" appears but not as its own standalone match for the capture
    // regex (there is no text following a recognized keyword form here other
    // than as part of a longer word) — use a message where the keyword sits
    // at the very end with nothing to capture after it.
    const result = await model.chat({ sessionId: 's', system: 'sys', messages: [userText('Karten für mein Deck suche')], tools: [] }, noopHandlers())

    expect(result.toolCalls[0]!.name).toBe('search_catalog')
    const args = JSON.parse(result.toolCalls[0]!.arguments) as { query: string }
    // Falls back to the last 1-3 words, never the entire sentence.
    expect(args.query.split(/\s+/).length).toBeLessThanOrEqual(3)
    expect(args.query).not.toContain('Karten für mein Deck')
  })

  describe('with a linked deck in the system prompt', () => {
    const deckSystem = [
      'You are a Yu-Gi-Oh! assistant.',
      'Deck ID: deck-1',
      'Deck name: Blue-Eyes Test',
      'Counts: Main 40 · Extra 5 · Side 2',
    ].join('\n')

    it('answers "Was ist in meinem Deck?" from the deck context block', async () => {
      const model = createFakeModel()
      const result = await model.chat({ sessionId: 's', system: deckSystem, messages: [userText('Was ist in meinem Deck?')], tools: [] }, noopHandlers())

      expect(result.toolCalls).toEqual([])
      expect(result.text).toBe('Kontext-Deck: Blue-Eyes Test (47 Karten)')
    })

    it('falls back to the echo without a deck context, or without the word "Deck"', async () => {
      const model = createFakeModel()
      const noContext = await model.chat({ sessionId: 's', system: 'sys', messages: [userText('Was ist in meinem Deck?')], tools: [] }, noopHandlers())
      expect(noContext.text).toBe('Testantwort: Was ist in meinem Deck?')

      const noDeckWord = await model.chat({ sessionId: 's', system: deckSystem, messages: [userText('Hallo')], tools: [] }, noopHandlers())
      expect(noDeckWord.text).toBe('Testantwort: Hallo')
    })
  })
})
