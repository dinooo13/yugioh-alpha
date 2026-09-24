// The chat assistant's model layer (server/utils/assistant-model.ts, ADR
// 0020): provider/status resolution, the model picker, the OpenAI-compatible
// provider on the AI SDK, the deterministic fakes used by tests and E2E, the
// title model (#129), and the error codes and tool error texts.

import { describe, expect, it } from 'vitest'
import { generateText, jsonSchema, streamText, tool } from 'ai'
import {
  AssistantToolError,
  assistantErrorCode,
  assistantStreamErrorText,
  createFakeTitleModel,
  createOpenAiCompatibleLanguageModel,
  DEFAULT_TITLE_MODEL,
  fakeStreamParts,
  fakeTitle,
  fakeTurn,
  getAssistantStatus,
  resolveModelChoice,
  resolveTitleModelId,
  toolErrorText,
  useAssistantLanguageModel,
  useAssistantTitleModel,
} from '../../server/utils/assistant-model'
import type { AssistantLanguageModel } from '../../server/utils/assistant-model'
import { buildTitleInstructions, buildTitlePrompt, TOOL_TEXT } from '../../server/utils/assistant-prompts'

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
      expect(getAssistantStatus()).toEqual({
        enabled: true,
        provider: 'fake',
        model: 'fake',
        models: ['fake'],
        defaultModel: 'fake',
        baseUrl: null,
        chat: true,
        vision: true,
        visionModel: null,
      })
      expect(useAssistantLanguageModel()?.id).toBe('fake')

      config.provider = ''
      config.baseUrl = ''
      config.apiKey = 'sk-test-key'
      config.model = ''
      expect(getAssistantStatus()).toEqual({
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        models: ['gpt-4o-mini'],
        defaultModel: 'gpt-4o-mini',
        baseUrl: 'api.openai.com',
        chat: true,
        vision: true,
        visionModel: null,
      })
      expect(useAssistantLanguageModel()?.id).toBe('gpt-4o-mini')

      // A configured vision model is reported separately.
      config.visionModel = 'gpt-4o'
      expect(getAssistantStatus().visionModel).toBe('gpt-4o')
      config.visionModel = ''

      // No key, but a base URL explicitly pointed away from the default
      // (e.g. a keyless local Ollama server) still resolves to 'openai'.
      config.apiKey = ''
      config.baseUrl = 'http://localhost:11434/v1'
      expect(getAssistantStatus()).toEqual({
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        models: ['gpt-4o-mini'],
        defaultModel: 'gpt-4o-mini',
        baseUrl: 'localhost:11434',
        chat: true,
        vision: true,
        visionModel: null,
      })

      config.baseUrl = ''
      expect(getAssistantStatus()).toEqual({
        enabled: false,
        provider: null,
        model: null,
        models: [],
        defaultModel: null,
        baseUrl: null,
        chat: false,
        vision: false,
        visionModel: null,
      })
      expect(useAssistantLanguageModel()).toBeNull()
    }
    finally {
      Object.assign(config, original)
    }
  })
})

describe('model picker (NUXT_ASSISTANT_MODELS)', () => {
  type Config = { provider: string, baseUrl: string, apiKey: string, model: string, models: string }

  function withConfig(overrides: Partial<Config>, run: () => void) {
    const config = useRuntimeConfig().assistant as Config
    const original = { ...config }
    try {
      Object.assign(config, overrides)
      run()
    }
    finally {
      Object.assign(config, original)
    }
  }

  it('resolves the list and its default: the configured model when listed, else the first entry', () => {
    const base = { model: 'mimo-v2.6-pro', visionModel: '', provider: 'openai', baseUrl: '', apiKey: '', reasoningEffort: '' }
    expect(resolveModelChoice({ ...base, models: ' glm-5.3-flash, mimo-v2.6-pro ,,glm-5.3-flash' }))
      .toEqual({ models: ['glm-5.3-flash', 'mimo-v2.6-pro'], defaultModel: 'mimo-v2.6-pro' })
    expect(resolveModelChoice({ ...base, model: 'other', models: 'glm-5.3-flash,deepseek-v4.1-flash' }))
      .toEqual({ models: ['glm-5.3-flash', 'deepseek-v4.1-flash'], defaultModel: 'glm-5.3-flash' })
    expect(resolveModelChoice({ ...base, models: '' })).toEqual({ models: ['mimo-v2.6-pro'], defaultModel: 'mimo-v2.6-pro' })
  })

  it('reports the models in the status and runs a turn on the picked one', () => {
    withConfig({ provider: 'openai', apiKey: 'sk-test', model: 'mimo-v2.6-pro', models: 'mimo-v2.6-pro,glm-5.3-flash,deepseek-v4.1-flash' }, () => {
      const status = getAssistantStatus()
      expect(status.models).toEqual(['mimo-v2.6-pro', 'glm-5.3-flash', 'deepseek-v4.1-flash'])
      expect(status.defaultModel).toBe('mimo-v2.6-pro')
      expect(status.model).toBe('mimo-v2.6-pro')

      expect(useAssistantLanguageModel()?.id).toBe('mimo-v2.6-pro')
      expect(useAssistantLanguageModel('glm-5.3-flash')?.id).toBe('glm-5.3-flash')
      expect(() => useAssistantLanguageModel('gpt-4o')).toThrowError(expect.objectContaining({ statusCode: 400, data: { code: 'assistant_model_not_allowed' } }))
    })
  })

  it('without a list, only the configured model is allowed', () => {
    withConfig({ provider: 'openai', apiKey: 'sk-test', model: 'mimo-v2.6-pro', models: '' }, () => {
      expect(getAssistantStatus().models).toEqual(['mimo-v2.6-pro'])
      expect(useAssistantLanguageModel('mimo-v2.6-pro')?.id).toBe('mimo-v2.6-pro')
      expect(() => useAssistantLanguageModel('glm-5.3-flash')).toThrowError(expect.objectContaining({ statusCode: 400 }))
    })
  })

  it('lets the fake report a configured list (the picker in E2E/dev), answering the same', () => {
    withConfig({ provider: 'fake', models: 'a,b' }, () => {
      expect(getAssistantStatus().models).toEqual(['a', 'b'])
      expect(useAssistantLanguageModel('b')?.id).toBe('b')
    })
  })

  it('names the model that answers: the vision model for a turn with photos', () => {
    const model = createOpenAiCompatibleLanguageModel({ baseUrl: 'https://g.test/v1', model: 'glm-5.3-flash', visionModel: 'vision-x' })
    expect(model.modelIdFor?.(false)).toBe('glm-5.3-flash')
    expect(model.modelIdFor?.(true)).toBe('vision-x')
  })

  it('passes the picked model id to the provider as is', async () => {
    const bodies: string[] = []
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(init.body)
      return new Response('data: {"id":"1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as unknown as typeof fetch
    const model = createOpenAiCompatibleLanguageModel({ baseUrl: 'https://g.test/v1', model: 'deepseek-v4.1-flash', fetch: fetchImpl })
    const result = streamText({ model: model.modelFor(false), prompt: 'hi' })
    await result.consumeStream()
    expect(JSON.parse(bodies[0]!).model).toBe('deepseek-v4.1-flash')
  })
})

describe('createOpenAiCompatibleLanguageModel (@ai-sdk/openai-compatible)', () => {
  interface Recorded { url: string, headers: Headers, body: Record<string, unknown> }

  function sse(payloads: unknown[]): string {
    return `${payloads.map(payload => `data: ${JSON.stringify(payload)}\n\n`).join('')}data: [DONE]\n\n`
  }

  function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
    return { id: 'r1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finishReason }] }
  }

  function fetchReturning(body: string, status = 200) {
    const calls: Recorded[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return new Response(body, { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' } })
    }) as typeof fetch
    return { fetch: fetchImpl, calls }
  }

  const TOOL_CALL_STREAM = sse([
    chunk({ role: 'assistant', reasoning_content: 'Ich sollte suchen.' }),
    chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search_catalog', arguments: '{"que' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: 'ry":"Dark"}' } }] }),
    chunk({}, 'tool_calls'),
  ])

  async function run(model: AssistantLanguageModel, hasImages = false) {
    const result = streamText({
      model: model.modelFor(hasImages),
      prompt: 'Hallo',
      tools: { search_catalog: tool({ inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' } } }) }) },
      ...(model.providerOptions ? { providerOptions: model.providerOptions } : {}),
      headers: { 'x-opencode-session': 'conversation-42' },
      maxRetries: 0,
      onError: () => {},
    })
    const parts = []
    for await (const part of result.stream) {
      parts.push(part)
    }
    return parts
  }

  it('sends reasoning_effort, x-opencode-session, the app\'s User-Agent and the key; parses streamed tool calls and reasoning', async () => {
    const { fetch: fetchImpl, calls } = fetchReturning(TOOL_CALL_STREAM)
    const model = createOpenAiCompatibleLanguageModel({ baseUrl: 'https://gateway.test/v1/', apiKey: 'sk-test', model: 'mimo', reasoningEffort: 'low', fetch: fetchImpl })

    const parts = await run(model)

    expect(calls[0]!.url).toBe('https://gateway.test/v1/chat/completions')
    expect(calls[0]!.body).toMatchObject({ model: 'mimo', stream: true, reasoning_effort: 'low', tool_choice: 'auto' })
    expect(calls[0]!.headers.get('x-opencode-session')).toBe('conversation-42')
    expect(calls[0]!.headers.get('user-agent')).toMatch(/^ygo-alpha\/\S+/)
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer sk-test')
    expect(parts).toContainEqual(expect.objectContaining({ type: 'tool-call', toolName: 'search_catalog', input: { query: 'Dark' } }))
    expect(parts).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', text: 'Ich sollte suchen.' }))
    expect(parts).toContainEqual(expect.objectContaining({ type: 'finish-step', finishReason: 'tool-calls' }))
  })

  it('omits reasoning_effort and the Authorization header when neither is configured (keyless local servers)', async () => {
    const { fetch: fetchImpl, calls } = fetchReturning(sse([chunk({ content: 'Hallo' }), chunk({}, 'stop')]))
    await run(createOpenAiCompatibleLanguageModel({ baseUrl: 'http://localhost:11434/v1', model: 'llama', fetch: fetchImpl }))

    expect(calls[0]!.body).not.toHaveProperty('reasoning_effort')
    expect(calls[0]!.headers.has('authorization')).toBe(false)
  })

  it('uses the vision model for a turn with images, when one is configured', async () => {
    const { fetch: fetchImpl, calls } = fetchReturning(sse([chunk({ content: 'x' }), chunk({}, 'stop')]))
    const withVision = createOpenAiCompatibleLanguageModel({ baseUrl: 'https://g.test/v1', model: 'text-model', visionModel: 'vision-model', fetch: fetchImpl })
    const withoutVision = createOpenAiCompatibleLanguageModel({ baseUrl: 'https://g.test/v1', model: 'text-model', fetch: fetchImpl })

    await run(withVision, true)
    await run(withVision, false)
    await run(withoutVision, true)

    expect(calls.map(call => call.body.model)).toEqual(['vision-model', 'text-model', 'text-model'])
  })

  it.each([
    [401, 'assistant_misconfigured'],
    [403, 'assistant_misconfigured'],
    [429, 'assistant_busy'],
    [500, 'assistant_unreachable'],
  ])('maps a provider %i to %s', async (status, code) => {
    const { fetch: fetchImpl } = fetchReturning(JSON.stringify({ error: { message: 'nope' } }), status)
    const parts = await run(createOpenAiCompatibleLanguageModel({ baseUrl: 'https://g.test/v1', model: 'm', fetch: fetchImpl }))

    const error = parts.find(part => part.type === 'error')
    expect(error).toBeDefined()
    expect(assistantErrorCode((error as { error: unknown }).error)).toBe(code)
  })

  it('maps a network failure to assistant_unreachable', async () => {
    // Nothing listens on port 1: a real connection error from Node's fetch.
    const parts = await run(createOpenAiCompatibleLanguageModel({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }))
    expect(assistantErrorCode((parts.find(part => part.type === 'error') as { error: unknown }).error)).toBe('assistant_unreachable')
  })

  it('resolves the configured model (or the fake) from runtimeConfig, and null when unconfigured', () => {
    const config = useRuntimeConfig().assistant as { provider: string, baseUrl: string, apiKey: string, model: string }
    const original = { ...config }
    try {
      config.provider = 'fake'
      expect(useAssistantLanguageModel()?.id).toBe('fake')
      config.provider = 'openai'
      config.model = 'mimo-v2.6-pro'
      expect(useAssistantLanguageModel()?.id).toBe('mimo-v2.6-pro')
      config.provider = ''
      config.apiKey = ''
      config.baseUrl = ''
      const originalEnvKey = process.env.OPENAI_API_KEY
      delete process.env.OPENAI_API_KEY
      expect(useAssistantLanguageModel()).toBeNull()
      if (originalEnvKey !== undefined) {
        process.env.OPENAI_API_KEY = originalEnvKey
      }
    }
    finally {
      Object.assign(config, original)
    }
  })
})

describe('the fake language model (NUXT_ASSISTANT_PROVIDER=fake)', () => {
  const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] })

  it('ports the former script: search, answer after a result, image, echo', () => {
    expect(fakeTurn({ prompt: [user('suche Dark Magician')] })).toEqual({ text: '', toolCalls: [{ toolName: 'search_catalog', input: { query: 'Dark Magician' } }] })
    expect(fakeTurn({ prompt: [
      user('suche Dark Magician'),
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1', toolName: 'search_catalog', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: '1', toolName: 'search_catalog', output: { type: 'json', value: { items: [{ id: 1, name: 'Dark Magician' }] } } }] },
    ] }).text).toBe('Ich habe 1 Karte gefunden: Dark Magician')
    expect(fakeTurn({ prompt: [{ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: { type: 'url', url: new URL('data:image/png;base64,abc') } }] }] }))
      .toEqual({ text: 'Auf dem Bild sehe ich: Dark Magician.', toolCalls: [{ toolName: 'search_catalog', input: { query: 'Dark Magician' } }] })
    expect(fakeTurn({ prompt: [user('Hallo')] }).text).toBe('Testantwort: Hallo')
    // No deck branch (ADR 0021): even a "Deck ID:" line in the system prompt gets the echo.
    expect(fakeTurn({ prompt: [{ role: 'system', content: 'Deck ID: d1' }, user('Was ist in meinem Deck?')] }).text).toBe('Testantwort: Was ist in meinem Deck?')
  })

  it('adds the first card of an earlier search (German or English add), and confirms the proposal', () => {
    const searched = [
      user('suche Dark Magician'),
      { role: 'assistant' as const, content: [{ type: 'tool-call' as const, toolCallId: '1', toolName: 'search_catalog', input: {} }] },
      { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: '1', toolName: 'search_catalog', output: { type: 'json' as const, value: { items: [{ id: 46986414, name: 'Dark Magician' }] } } }] },
    ]
    expect(fakeTurn({ prompt: [...searched, user('füge 2 hinzu')] }).toolCalls)
      .toEqual([{ toolName: 'add_to_inventory', input: { items: [{ catalogCardId: 46986414, quantity: 2 }] } }])
    expect(fakeTurn({ prompt: [...searched, user('add 3 of them')] }).toolCalls)
      .toEqual([{ toolName: 'add_to_inventory', input: { items: [{ catalogCardId: 46986414, quantity: 3 }] } }])
    expect(fakeTurn({ prompt: [
      user('füge 2 hinzu'),
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: '2', toolName: 'add_to_inventory', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: '2', toolName: 'add_to_inventory', output: { type: 'json', value: { status: 'pending_confirmation' } } }] },
    ] })).toEqual({ text: 'Ich habe einen Vorschlag angelegt.', toolCalls: [] })
  })

  it('takes "suche" as a search intent only as a word, and searches for the last few words when nothing follows it', () => {
    expect(fakeTurn({ prompt: [user('ich versuche das Deck zu bauen')] })).toEqual({ text: 'Testantwort: ich versuche das Deck zu bauen', toolCalls: [] })
    const { toolCalls } = fakeTurn({ prompt: [user('Karten für mein Deck suche')] })
    const query = (toolCalls[0]!.input as { query: string }).query
    expect(toolCalls[0]!.toolName).toBe('search_catalog')
    expect(query.split(/\s+/).length).toBeLessThanOrEqual(3)
    expect(query).not.toContain('Karten für mein Deck')
  })

  it('streams one answer as language-model stream parts', () => {
    const parts = fakeStreamParts({ text: 'Hallo', toolCalls: [{ toolName: 'list_formats', input: {} }] })
    expect(parts.map(part => part.type)).toEqual(['stream-start', 'text-start', 'text-delta', 'text-end', 'tool-call', 'finish'])
    expect(parts.at(-1)).toMatchObject({ finishReason: { unified: 'tool-calls' } })
  })

  it('has the two #54 test triggers', () => {
    expect(fakeTurn({ prompt: [user('leere argumente')] }).toolCalls).toEqual([{ toolName: 'search_catalog', input: '' }])
    expect(fakeTurn({ prompt: [user('leere argumente')], toolChoice: { type: 'none' } }).text).toBe('Ich kann das Werkzeug gerade nicht nutzen.')
    expect(fakeTurn({ prompt: [user('text-werkzeug')] })).toEqual({ text: 'search_catalog {"query":"Dark Magician"}', toolCalls: [] })
    expect(fakeTurn({ prompt: [{ role: 'system', content: TOOL_TEXT.textWrittenToolCallHint }, user('text-werkzeug')] }).toolCalls)
      .toEqual([{ toolName: 'search_catalog', input: { query: 'Dark Magician' } }])
  })
})

describe('the fake\'s #128 triggers: get_card and reasoning', () => {
  const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] })

  it('reads a card by its id, then answers', () => {
    expect(fakeTurn({ prompt: [user('zeige karte 46986414')] })).toEqual({ text: '', toolCalls: [{ toolName: 'get_card', input: { id: 46986414 } }] })
    expect(fakeTurn({ prompt: [
      user('zeige karte 46986414'),
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1', toolName: 'get_card', input: { id: 46986414 } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: '1', toolName: 'get_card', output: { type: 'json', value: { id: 46986414, name: 'Dark Magician' } } }] },
    ] })).toEqual({ text: 'Kartendetails gelesen.', toolCalls: [] })
  })

  it('streams reasoning before the text', () => {
    const turn = fakeTurn({ prompt: [user('denk nach')] })
    expect(turn).toEqual({ reasoning: 'Ich überlege kurz.', text: 'Fertig überlegt.', toolCalls: [] })
    const parts = fakeStreamParts(turn)
    expect(parts.map(part => part.type)).toEqual(['stream-start', 'reasoning-start', 'reasoning-delta', 'reasoning-end', 'text-start', 'text-delta', 'text-end', 'finish'])
    expect(parts[2]).toMatchObject({ delta: 'Ich überlege kurz.' })
  })
})

describe('the title model (NUXT_ASSISTANT_TITLE_MODEL, #129)', () => {
  it('resolves the configured id: empty = the default, "off" (any case) = none', () => {
    expect(resolveTitleModelId({ titleModel: '' })).toBe(DEFAULT_TITLE_MODEL)
    expect(resolveTitleModelId({ titleModel: '  ' })).toBe('glm-5.3-flash')
    expect(resolveTitleModelId({})).toBe('glm-5.3-flash')
    expect(resolveTitleModelId({ titleModel: 'off' })).toBeNull()
    expect(resolveTitleModelId({ titleModel: ' OFF ' })).toBeNull()
    expect(resolveTitleModelId({ titleModel: ' gpt-4o-mini ' })).toBe('gpt-4o-mini')
  })

  it('is the fake title model with the fake provider, the configured one with openai, and none when off or unconfigured', () => {
    const config = useRuntimeConfig().assistant as { provider: string, baseUrl: string, apiKey: string, model: string, reasoningEffort: string, titleModel: string }
    const original = { ...config }
    const originalEnvKey = process.env.OPENAI_API_KEY
    try {
      config.provider = 'fake'
      config.titleModel = ''
      expect(useAssistantTitleModel()).toMatchObject({ id: 'glm-5.3-flash', model: { provider: 'fake' } })
      config.titleModel = 'off'
      expect(useAssistantTitleModel()).toBeNull()

      config.provider = 'openai'
      config.titleModel = 'glm-5.3-flash'
      config.reasoningEffort = 'low'
      const title = useAssistantTitleModel()
      expect(title?.id).toBe('glm-5.3-flash')
      expect(title?.model).toMatchObject({ modelId: 'glm-5.3-flash' })
      expect(title?.providerOptions).toEqual({ assistant: { reasoningEffort: 'low' } })

      config.provider = ''
      config.apiKey = ''
      config.baseUrl = ''
      delete process.env.OPENAI_API_KEY
      expect(useAssistantTitleModel()).toBeNull()
    }
    finally {
      Object.assign(config, original)
      if (originalEnvKey !== undefined) {
        process.env.OPENAI_API_KEY = originalEnvKey
      }
    }
  })

  const call = (locale: 'de' | 'en', userText: string, answerText = 'Antwort.') => ({
    prompt: [
      { role: 'system' as const, content: buildTitleInstructions(locale) },
      { role: 'user' as const, content: [{ type: 'text' as const, text: buildTitlePrompt({ userText, answerText }) }] },
    ],
  })

  it('the fake names the conversation after the first message\'s first words, in the interface language', () => {
    expect(fakeTitle(call('de', 'suche Dark Magician'))).toBe('Thema: suche Dark Magician')
    expect(fakeTitle(call('en', 'suche Dark Magician'))).toBe('Topic: suche Dark Magician')
    expect(fakeTitle(call('de', 'bitte baue mir ein Deck mit Magiern'))).toBe('Thema: bitte baue mir ein')
    expect(fakeTitle(call('de', '', 'Auf dem Bild sehe ich Dark Magician.'))).toBe('Thema: Auf dem Bild sehe')
    expect(fakeTitle(call('de', '', ''))).toBe('Thema: Foto')
    expect(fakeTitle(call('de', 'suche Dark Magician'))).toBe(fakeTitle(call('de', 'suche Dark Magician')))
  })

  it('the fake fails on "titel-fehler" (the fallback trigger)', () => {
    expect(() => fakeTitle(call('de', 'titel-fehler bitte'))).toThrow('fake title failure')
  })

  it('the fake title model answers through generateText', async () => {
    const result = await generateText({ model: createFakeTitleModel(), instructions: buildTitleInstructions('de'), prompt: buildTitlePrompt({ userText: 'suche Dark Magician', answerText: '' }) })
    expect(result.text).toBe('Thema: suche Dark Magician')
  })
})

describe('tool error texts', () => {
  it('reads our message out of the SDK\'s error objects and strings, else a generic text', () => {
    expect(toolErrorText(new AssistantToolError('Deck not found'))).toBe('Deck not found')
    expect(toolErrorText('AI_InvalidToolInputError: Invalid input for tool x: AI_TypeValidationError: Type validation failed: Value: {}.\nError message: AssistantToolError: The tool arguments were empty.')).toBe('The tool arguments were empty.')
    expect(toolErrorText('AI_InvalidToolInputError: Invalid input for tool x: AI_JSONParseError: JSON parsing failed')).toBe(TOOL_TEXT.invalidArguments)
    expect(toolErrorText('AI_NoSuchToolError: Model tried to call unavailable tool \'nope\'. Available tools: a.')).toBe(TOOL_TEXT.unknownTool('nope'))
    expect(toolErrorText(new Error('boom'))).toBe(TOOL_TEXT.unexpectedError)
  })

  it('gives a tool part its error text and a turn-ending error its code', () => {
    expect(assistantStreamErrorText(new AssistantToolError('Deck not found'))).toBe('Deck not found')
    expect(assistantStreamErrorText(new Error('boom'))).toBe('unexpected')
  })
})
