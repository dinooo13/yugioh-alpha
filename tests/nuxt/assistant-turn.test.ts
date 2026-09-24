// The chat turn on the AI SDK (server/utils/assistant-turn.ts, ADR 0020):
// streamText's tool loop driven by scripted `MockLanguageModelV4`s, the UI
// message stream it produces, what gets persisted, the fallback texts and
// the #54 guards against looping tool calls.

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { APICallError, InvalidToolInputError, NoSuchToolError, RetryError, TypeValidationError } from 'ai'
import type { InferUIMessageChunk } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import * as schema from '../../server/db/schema'
import { createConversation } from '../../server/utils/assistant-chat'
import { applyAction } from '../../server/utils/assistant-tools'
import type { AssistantLimits } from '../../server/utils/assistant-limits'
import { AssistantToolError, assistantErrorCode, createFakeLanguageModel } from '../../server/utils/assistant-model'
import type { AssistantLanguageModel } from '../../server/utils/assistant-model'
import {
  appendToLastText,
  cleanToolErrorOutputs,
  detectTextWrittenToolCall,
  startAssistantTurn,
} from '../../server/utils/assistant-turn'
import type { AssistantTurnOptions } from '../../server/utils/assistant-turn'
import { loadUiMessages, validateAssistantTurnRequest } from '../../server/utils/assistant-ui-messages'
import { CARD_NAME_INSTRUCTION, REPLY_LANGUAGE_INSTRUCTION, TOOL_TEXT, TURN_TEXT } from '../../server/utils/assistant-prompts'
import { createDeck, upsertDeckCard } from '../../server/utils/decks'
import type { AssistantUIMessage } from '../../shared/assistant-ui'
import { seedGermanNames } from './fixtures/german-names'

const CARD = {
  darkMagician: 46986414,
  potOfGreed: 55144522,
} as const

const LIMITS: AssistantLimits = {
  maxToolRounds: 24,
  toolResultItems: 100,
  toolResultChars: 60_000,
  historyMessages: 120,
  historyChars: 160_000,
  timeoutMs: 300_000,
}

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>
type Chunk = InferUIMessageChunk<AssistantUIMessage>
type CallOptions = Parameters<MockLanguageModelV4['doStream']>[0]
type StreamPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer PART> ? PART : never
type FinishUnified = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  const now = new Date()
  db.insert(schema.user).values([
    { id: 'user-a', name: 'User A', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'User B', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()
  db.insert(schema.catalogCard).values([
    { id: CARD.darkMagician, name: 'Dark Magician', type: 'Normal Monster', desc: 'The ultimate wizard.', syncedAt: now },
    { id: CARD.potOfGreed, name: 'Pot of Greed', type: 'Spell Card', desc: 'Draw two cards.', syncedAt: now },
  ]).run()
})

// --- Scripted model -----------------------------------------------------------------

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

let callCounter = 0

/** One model step: optional reasoning and text, tool calls (input as the raw JSON string the provider sent), and the finish reason. */
function step(fields: { text?: string, reasoning?: string, calls?: Array<{ name: string, input: string }>, finish?: FinishUnified }): StreamPart[] {
  const parts: StreamPart[] = [{ type: 'stream-start', warnings: [] }]
  if (fields.reasoning) {
    parts.push({ type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', delta: fields.reasoning }, { type: 'reasoning-end', id: 'r' })
  }
  if (fields.text) {
    parts.push({ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: fields.text }, { type: 'text-end', id: 't' })
  }
  for (const call of fields.calls ?? []) {
    callCounter += 1
    parts.push({ type: 'tool-call', toolCallId: `call-${callCounter}`, toolName: call.name, input: call.input })
  }
  const finish = fields.finish ?? ((fields.calls?.length ?? 0) > 0 ? 'tool-calls' : 'stop')
  parts.push({ type: 'finish', finishReason: { unified: finish, raw: finish }, usage: USAGE })
  return parts
}

const text = (value: string, finish?: FinishUnified) => step({ text: value, finish })
const call = (name: string, input: Record<string, unknown> | string, extra: { text?: string } = {}) =>
  step({ ...extra, calls: [{ name, input: typeof input === 'string' ? input : JSON.stringify(input) }] })

function streamOf(parts: StreamPart[]): ReadableStream<StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part)
      }
      controller.close()
    },
  })
}

/** A model answering each call with the next script entry (the last one repeats); a function entry decides per call. */
function scriptedModel(script: Array<StreamPart[] | ((options: CallOptions) => StreamPart[] | Promise<ReadableStream<StreamPart>>)>) {
  const calls: CallOptions[] = []
  const mock = new MockLanguageModelV4({
    doStream: async (options) => {
      calls.push(options)
      const entry = script[Math.min(calls.length - 1, script.length - 1)]!
      const result = typeof entry === 'function' ? await entry(options) : entry
      return { stream: result instanceof ReadableStream ? result : streamOf(result) }
    },
  })
  const model: AssistantLanguageModel = { id: 'scripted', modelFor: () => mock }
  return { model, calls }
}

function systemOf(options: CallOptions): string {
  return options.prompt.flatMap(message => message.role === 'system' ? [message.content] : []).join('\n\n')
}

function toolResultsOf(options: CallOptions) {
  return options.prompt.flatMap(message => message.role === 'tool' ? message.content : [])
}

// --- Running a turn ------------------------------------------------------------------

async function runTurn(conversationId: string, model: AssistantLanguageModel, overrides: Partial<AssistantTurnOptions> & { body?: unknown } = {}) {
  const { body, ...rest } = overrides
  const request = validateAssistantTurnRequest(body ?? { trigger: 'submit-message', message: { role: 'user', parts: [{ type: 'text', text: 'Hallo' }] } })
  let settled = 0
  const turn = startAssistantTurn({
    db,
    userId: 'user-a',
    conversationId,
    request,
    model,
    locale: 'de',
    cardLocale: 'de',
    limits: LIMITS,
    onSettled: () => {
      settled += 1
    },
    ...rest,
  })
  const chunks: Chunk[] = []
  for await (const chunk of turn.stream) {
    chunks.push(chunk)
  }
  return { turn, chunks, settled: () => settled }
}

function userText(value: string) {
  return { trigger: 'submit-message', message: { role: 'user', parts: [{ type: 'text', text: value }] } }
}

function storedMessages(conversationId: string) {
  return db.select().from(schema.assistantMessage).where(eq(schema.assistantMessage.conversationId, conversationId)).all()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

function assistantParts(conversationId: string) {
  return storedMessages(conversationId).filter(row => row.role === 'assistant').at(-1)!.parts!
}

function newConversation() {
  return createConversation(db, 'user-a').id
}

// --- Tests ---------------------------------------------------------------------------

describe('startAssistantTurn: the tool loop', () => {
  it('runs a tool, feeds the result back and answers — persisted as one UIMessage', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([call('search_catalog', { query: 'Dark' }), text('Gefunden: Dark Magician.')])

    const { chunks, turn, settled } = await runTurn(conversationId, model, { body: userText('suche Dark') })

    expect(calls).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ type: 'start', messageId: turn.assistantMessageId })
    expect(chunks.map(chunk => chunk.type)).toContain('tool-output-available')
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' })
    expect(settled()).toBe(1)

    const rows = storedMessages(conversationId)
    expect(rows.map(row => row.role)).toEqual(['user', 'assistant'])
    expect(rows[0]!.parts).toEqual([{ type: 'text', text: 'suche Dark' }])
    expect(rows[1]!.id).toBe(turn.assistantMessageId)
    expect(rows[1]!.content).toBe('Gefunden: Dark Magician.')
    const parts = rows[1]!.parts!
    expect(parts.map(part => part.type)).toEqual(['step-start', 'tool-search_catalog', 'step-start', 'text'])
    expect(parts[1]).toMatchObject({ state: 'output-available', input: { query: 'Dark' }, output: { result: { items: [{ id: CARD.darkMagician, name: 'Dark Magician' }] } } })

    // The model read the result itself, without the display-only wrapper.
    const [result] = toolResultsOf(calls[1]!)
    expect(result).toMatchObject({ type: 'tool-result', toolName: 'search_catalog', output: { type: 'json', value: { items: [{ id: CARD.darkMagician }] } } })
  })

  it('stores a write tool\'s proposal as a pending action of the answer and streams it as a data-action part after its chip', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([
      call('add_to_inventory', { items: [{ catalogCardId: CARD.darkMagician, quantity: 2 }] }),
      text('Ich habe einen Vorschlag angelegt.'),
    ])

    const { chunks, turn } = await runTurn(conversationId, model, { body: userText('füge 2 Dark Magician hinzu') })

    const actionRow = db.select().from(schema.assistantAction).get()!
    expect(actionRow).toMatchObject({ messageId: turn.assistantMessageId, status: 'pending', kind: 'add_to_inventory' })
    const types = chunks.map(chunk => chunk.type)
    expect(types.indexOf('data-action')).toBe(types.indexOf('tool-output-available') + 1)
    expect(chunks.find(chunk => chunk.type === 'data-action')).toMatchObject({ id: actionRow.id, data: { id: actionRow.id, status: 'pending' } })

    const parts = assistantParts(conversationId)
    expect(parts.map(part => part.type)).toEqual(['step-start', 'tool-add_to_inventory', 'data-action', 'step-start', 'text'])
  })

  it('hands unparseable arguments back to the model as a tool error and goes on', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([call('search_catalog', '{"query": "Dark'), text('Entschuldigung.')])

    await runTurn(conversationId, model)

    expect(calls).toHaveLength(2)
    expect(toolResultsOf(calls[1]!)[0]).toMatchObject({ output: { type: 'error-text', value: TOOL_TEXT.invalidArguments } })
    expect(assistantParts(conversationId)[1]).toMatchObject({ state: 'output-error', errorText: TOOL_TEXT.invalidArguments })
  })

  it('answers empty arguments with the emptyArguments hint (#54), for `{}` and for ""', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([call('search_catalog', {}), call('get_card', ''), text('ok')])

    await runTurn(conversationId, model)

    expect(toolResultsOf(calls[1]!)).toMatchObject([{ output: { type: 'error-text', value: TOOL_TEXT.emptyArguments } }])
    expect(toolResultsOf(calls[2]!).at(-1)).toMatchObject({ toolName: 'get_card', output: { type: 'error-text', value: TOOL_TEXT.emptyArguments } })
    const parts = assistantParts(conversationId)
    expect(parts.filter(part => part.type.startsWith('tool-'))).toMatchObject([
      { state: 'output-error', errorText: TOOL_TEXT.emptyArguments },
      { state: 'output-error', errorText: TOOL_TEXT.emptyArguments },
    ])
  })

  it('keeps an invalid call\'s input in `input`, never in the deprecated `rawInput` — the SDK warns about nothing, now or on the next turn', async () => {
    const warnings: unknown[] = []
    const previous = (globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS
    ;(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = (options: { warnings: unknown[] }) => warnings.push(...options.warnings)
    try {
      const conversationId = newConversation()
      const { model } = scriptedModel([call('search_catalog', {}), call('get_card', '{"id": 4'), text('ok')])

      const { chunks } = await runTurn(conversationId, model)
      await runTurn(conversationId, model, { body: userText('Und jetzt?') })

      expect(chunks.map(chunk => chunk.type)).not.toContain('tool-input-error')
      const parts = storedMessages(conversationId)[1]!.parts!.filter(part => part.type.startsWith('tool-'))
      expect(parts).toMatchObject([
        { state: 'output-error', input: {}, errorText: TOOL_TEXT.emptyArguments },
        { state: 'output-error', input: '{"id": 4', errorText: TOOL_TEXT.invalidArguments },
      ])
      expect(parts.some(part => 'rawInput' in part)).toBe(false)
      expect(warnings).toEqual([])
    }
    finally {
      ;(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = previous
    }
  })

  it('moves the `rawInput` of parts stored by earlier versions to `input` when read', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([text('ok')])
    await runTurn(conversationId, model)
    const answer = storedMessages(conversationId)[1]!
    db.update(schema.assistantMessage)
      .set({ parts: [{ type: 'tool-search_catalog', toolCallId: 'c1', state: 'output-error', rawInput: { query: '' }, errorText: 'x' } as never, { type: 'text', text: 'ok', state: 'done' }] })
      .where(eq(schema.assistantMessage.id, answer.id))
      .run()

    expect(loadUiMessages(db, 'user-a', conversationId)[1]!.parts[0]).toEqual({ type: 'tool-search_catalog', toolCallId: 'c1', state: 'output-error', input: { query: '' }, errorText: 'x' })
  })

  it('hands a tool\'s own validation error to the model as its English message', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([call('get_deck', { id: 'nope' }), text('ok')])

    await runTurn(conversationId, model)

    expect(toolResultsOf(calls[1]!)[0]).toMatchObject({ output: { type: 'error-text', value: 'Deck not found' } })
  })

  it('switches tools off after two identical failures and answers in text (#54)', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([
      options => options.toolChoice?.type === 'none' ? text('Ohne Werkzeug: keine Ahnung.') : call('search_catalog', {}),
    ])

    const { chunks } = await runTurn(conversationId, model)

    expect(calls.map(options => options.toolChoice?.type)).toEqual(['auto', 'auto', 'none'])
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' })
    expect(storedMessages(conversationId).at(-1)!.content).toBe('Ohne Werkzeug: keine Ahnung.')
  })

  it('stops after the third identical failure and says so (#54), even when the model ignores toolChoice none', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([call('search_catalog', {})])

    await runTurn(conversationId, model)

    expect(calls).toHaveLength(3)
    expect(storedMessages(conversationId).at(-1)!.content).toBe(TURN_TEXT.de.repeatedToolFailure)
  })

  it('does not count different failing calls as a repetition', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([
      call('get_deck', { id: 'a' }),
      call('get_deck', { id: 'b' }),
      call('get_deck', { id: 'c' }),
      text('Keins gefunden.'),
    ])

    await runTurn(conversationId, model)

    expect(calls.map(options => options.toolChoice?.type)).toEqual(['auto', 'auto', 'auto', 'auto'])
    expect(storedMessages(conversationId).at(-1)!.content).toBe('Keins gefunden.')
  })

  it('runs one corrective continuation for a tool call written as text (#54) — never two', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([text('search_catalog {"query":"Dark Magician"}')])

    const { chunks } = await runTurn(conversationId, model)

    expect(calls).toHaveLength(2)
    expect(systemOf(calls[0]!)).not.toContain(TOOL_TEXT.textWrittenToolCallHint)
    expect(systemOf(calls[1]!)).toContain(TOOL_TEXT.textWrittenToolCallHint)
    // The continuation sees the garbled answer and streams into the same message.
    expect(calls[1]!.prompt.at(-1)).toMatchObject({ role: 'assistant' })
    expect(chunks.filter(chunk => chunk.type === 'start')).toHaveLength(1)
    expect(storedMessages(conversationId).filter(row => row.role === 'assistant')).toHaveLength(1)
  })

  it('makes the real call in the continuation and answers from its result', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([
      text('<tool_call>search_catalog</tool_call>'),
      call('search_catalog', { query: 'Dark' }),
      text('1 Karte gefunden.'),
    ])

    await runTurn(conversationId, model)

    expect(calls).toHaveLength(3)
    const parts = assistantParts(conversationId)
    expect(parts.map(part => part.type)).toEqual(['step-start', 'text', 'step-start', 'tool-search_catalog', 'step-start', 'text'])
  })

  it('ends with tooManySteps when the step cap is reached while the model still calls tools', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([call('list_formats', {})])

    await runTurn(conversationId, model, { limits: { ...LIMITS, maxToolRounds: 2 } })

    expect(calls).toHaveLength(2)
    expect(storedMessages(conversationId).at(-1)!.content).toBe(TURN_TEXT.de.tooManySteps)
  })

  it('marks an answer cut off by a length limit, and stops the loop even on a tool-call step', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([text('Eine lange Antw', 'length')])
    await runTurn(conversationId, model)
    expect(storedMessages(conversationId).at(-1)!.content).toBe(`Eine lange Antw\n\n${TURN_TEXT.de.cutOffSuffix}`)

    const second = newConversation()
    const { model: empty } = scriptedModel([step({ finish: 'length' })])
    await runTurn(second, empty)
    expect(storedMessages(second).at(-1)!.content).toBe(`${TURN_TEXT.de.cutOffFallback} ${TURN_TEXT.de.cutOffSuffix}`)
  })

  it('replaces an empty or content-filtered answer with noAnswer', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([step({ finish: 'stop' })])
    await runTurn(conversationId, model)
    expect(storedMessages(conversationId).at(-1)!.content).toBe(TURN_TEXT.de.noAnswer)

    const filtered = newConversation()
    const { model: filter } = scriptedModel([step({ finish: 'content-filter' })])
    await runTurn(filtered, filter)
    expect(storedMessages(filtered).at(-1)!.content).toBe(TURN_TEXT.de.noAnswer)
  })

  it('streams and stores reasoning, but never sends it back to the model', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([step({ reasoning: 'Hmm, suchen.', calls: [{ name: 'list_formats', input: '{}' }] }), text('Fertig.')])

    const { chunks } = await runTurn(conversationId, model)

    expect(chunks.some(chunk => chunk.type === 'reasoning-delta')).toBe(true)
    expect(assistantParts(conversationId)).toContainEqual(expect.objectContaining({ type: 'reasoning', text: 'Hmm, suchen.' }))

    await runTurn(conversationId, model, { body: userText('Und?') })
    const history = calls.at(-1)!.prompt
    expect(JSON.stringify(history)).not.toContain('Hmm, suchen.')
  })
})

describe('startAssistantTurn: cancel, timeouts and errors', () => {
  /** A step that streams `text`, then waits until the call is aborted (and errors like a cancelled fetch). */
  function hangingAfter(value: string) {
    return async (options: CallOptions) => new ReadableStream<StreamPart>({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] })
        controller.enqueue({ type: 'text-start', id: 't' })
        controller.enqueue({ type: 'text-delta', id: 't', delta: value })
        options.abortSignal?.addEventListener('abort', () => {
          controller.error(new DOMException('The operation was aborted.', 'AbortError'))
        })
      },
    })
  }

  it('saves the partial answer marked as cancelled when the client goes away', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([hangingAfter('Ich schaue na')])
    const controller = new AbortController()

    const turn = startAssistantTurn({
      db, userId: 'user-a', conversationId, request: validateAssistantTurnRequest(userText('Hallo')), model,
      locale: 'de', cardLocale: 'de', limits: LIMITS, signal: controller.signal,
    })
    const chunks: Chunk[] = []
    for await (const chunk of turn.stream) {
      chunks.push(chunk)
      if (chunk.type === 'text-delta') {
        controller.abort()
      }
    }

    expect(chunks.at(-1)).toMatchObject({ type: 'abort' })
    expect(storedMessages(conversationId).at(-1)!.content).toBe(`Ich schaue na ${TURN_TEXT.de.cancelledSuffix}`)
  })

  it('saves just the cancelled marker when nothing was produced yet, and closes open tool calls', async () => {
    const parts = appendToLastText([{ type: 'step-start' }], TURN_TEXT.en.cancelledSuffix)
    expect(parts).toEqual([{ type: 'step-start' }, { type: 'text', text: '… (cancelled)', state: 'done' }])
  })

  it('ends a turn that runs past its deadline with the timeout text', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([hangingAfter('Moment')])

    const { chunks, settled } = await runTurn(conversationId, model, { turnTimeoutMs: 50 })

    expect(chunks.some(chunk => chunk.type === 'abort')).toBe(false)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' })
    expect(storedMessages(conversationId).at(-1)!.content).toBe(`Moment\n\n${TURN_TEXT.de.timeout}`)
    expect(settled()).toBe(1)
  })

  it('reports a single model call running into limits.timeoutMs as assistant_unreachable', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([hangingAfter('Moment')])

    const { chunks } = await runTurn(conversationId, model, { limits: { ...LIMITS, timeoutMs: 50 } })

    expect(chunks).toContainEqual({ type: 'error', errorText: 'assistant_unreachable' })
  })

  it.each([
    [401, 'assistant_misconfigured'],
    [403, 'assistant_misconfigured'],
    [429, 'assistant_busy'],
    [500, 'assistant_unreachable'],
  ])('ends the turn with an error chunk carrying the code for a provider %i', async (statusCode, code) => {
    const conversationId = newConversation()
    const mock = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: 'nope', url: 'https://example.test', requestBodyValues: {}, statusCode, isRetryable: false })
      },
    })

    const { chunks, settled } = await runTurn(conversationId, { id: 'x', modelFor: () => mock })

    expect(chunks).toContainEqual({ type: 'error', errorText: code })
    expect(chunks.some(chunk => chunk.type === 'finish')).toBe(false)
    // Nothing of an answer to keep: only the user message stays.
    expect(storedMessages(conversationId).map(row => row.role)).toEqual(['user'])
    expect(settled()).toBe(1)
  })

  it('maps retried provider errors, network failures and h3 errors to their codes', () => {
    const busy = new APICallError({ message: 'x', url: 'u', requestBodyValues: {}, statusCode: 429 })
    expect(assistantErrorCode(new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [busy] }))).toBe('assistant_busy')
    expect(assistantErrorCode(new APICallError({ message: 'Cannot connect', url: 'u', requestBodyValues: {}, isRetryable: true }))).toBe('assistant_unreachable')
    expect(assistantErrorCode(new DOMException('t', 'TimeoutError'))).toBe('assistant_unreachable')
    expect(assistantErrorCode({ statusCode: 404, data: { code: 'conversation_not_found' } })).toBe('conversation_not_found')
    expect(assistantErrorCode(new Error('boom'))).toBe('unexpected')
  })

  it('sets the title from the first message even when the turn fails, and bumps updatedAt', async () => {
    const conversationId = newConversation()
    const before = db.select().from(schema.assistantConversation).get()!.updatedAt
    await new Promise(resolve => setTimeout(resolve, 5))
    const mock = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: 'down', url: 'u', requestBodyValues: {}, statusCode: 502, isRetryable: false })
      },
    })

    await runTurn(conversationId, { id: 'x', modelFor: () => mock }, { body: userText('Welche Karten habe ich?') })

    const row = db.select().from(schema.assistantConversation).get()!
    expect(row.title).toBe('Welche Karten habe ich?')
    expect(row.updatedAt.getTime()).toBeGreaterThan(before.getTime())
  })

  it('404s before anything is stored for another user\'s conversation', () => {
    const foreign = createConversation(db, 'user-b').id
    const { model } = scriptedModel([text('x')])
    expect(() => startAssistantTurn({
      db, userId: 'user-a', conversationId: foreign, request: validateAssistantTurnRequest(userText('x')), model, locale: 'de', cardLocale: 'de', limits: LIMITS,
    })).toThrowError(expect.objectContaining({ statusCode: 404 }))
    expect(storedMessages(foreign)).toEqual([])
  })
})

describe('startAssistantTurn: history, images and regenerate', () => {
  it('keeps the history window within the limits, starting at a user message', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([text('Antwort')])
    for (const message of ['eins', 'zwei', 'drei']) {
      await runTurn(conversationId, model, { body: userText(message) })
    }

    await runTurn(conversationId, model, { body: userText('vier'), limits: { ...LIMITS, historyMessages: 3 } })

    const prompt = calls.at(-1)!.prompt.filter(message => message.role !== 'system')
    // The last 3 messages are [assistant, user drei... ] → trimmed to start at "drei".
    expect(prompt.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(prompt[0])).toContain('drei')
  })

  it('sends photos to the model in their own turn only; history keeps a placeholder, never the bytes', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([text('Das ist Dark Magician.')])
    const image = 'data:image/png;base64,iVBORw0KGgo='

    await runTurn(conversationId, model, { body: { trigger: 'submit-message', message: { role: 'user', parts: [{ type: 'text', text: 'Was ist das?' }, { type: 'file', mediaType: 'image/png', url: image }] } } })

    const current = calls[0]!.prompt.at(-1)!
    expect(current).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Was ist das?' }, { type: 'file', mediaType: 'image/png' }] })
    expect(systemOf(calls[0]!)).toContain('This message contains one or more images')

    const stored = storedMessages(conversationId)[0]!
    expect(stored.parts).toEqual([{ type: 'text', text: 'Was ist das?' }, { type: 'data-image', data: { index: 1 } }])
    expect(stored.attachments).toBeNull()
    expect(JSON.stringify(stored)).not.toContain('iVBORw0KGgo')

    await runTurn(conversationId, model, { body: userText('Und jetzt?') })
    expect(JSON.stringify(calls[1]!.prompt)).not.toContain('iVBORw0KGgo')
    expect(systemOf(calls[1]!)).not.toContain('This message contains one or more images')
  })

  it('regenerates the last answer while its proposals are all pending, removing them', async () => {
    const conversationId = newConversation()
    const { model, calls } = scriptedModel([
      call('add_to_inventory', { items: [{ catalogCardId: CARD.darkMagician, quantity: 1 }] }),
      text('Vorschlag angelegt.'),
      text('Neue Antwort.'),
    ])
    await runTurn(conversationId, model, { body: userText('füge Dark Magician hinzu') })
    expect(db.select().from(schema.assistantAction).all()).toHaveLength(1)

    await runTurn(conversationId, model, { body: { trigger: 'regenerate-message', messageId: 'whatever' } })

    expect(calls).toHaveLength(3)
    expect(storedMessages(conversationId).map(row => [row.role, row.content])).toEqual([
      ['user', 'füge Dark Magician hinzu'],
      ['assistant', 'Neue Antwort.'],
    ])
    expect(db.select().from(schema.assistantAction).all()).toHaveLength(0)
  })

  it('refuses to regenerate an answer whose proposal was already resolved (409)', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([
      call('add_to_inventory', { items: [{ catalogCardId: CARD.darkMagician, quantity: 1 }] }),
      text('Vorschlag angelegt.'),
    ])
    await runTurn(conversationId, model, { body: userText('füge Dark Magician hinzu') })
    await applyAction(db, 'user-a', db.select().from(schema.assistantAction).get()!.id)

    await expect(runTurn(conversationId, model, { body: { trigger: 'regenerate-message' } }))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'regenerate_not_allowed' } })
    expect(storedMessages(conversationId)).toHaveLength(2)
  })

  it('retries a failed turn with regenerate (nothing to delete after the last user message)', async () => {
    const conversationId = newConversation()
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: 'down', url: 'u', requestBodyValues: {}, statusCode: 500, isRetryable: false })
      },
    })
    await runTurn(conversationId, { id: 'x', modelFor: () => failing }, { body: userText('Hallo?') })
    const { model } = scriptedModel([text('Jetzt klappt es.')])

    await runTurn(conversationId, model, { body: { trigger: 'regenerate-message' } })

    expect(storedMessages(conversationId).map(row => row.content)).toEqual(['Hallo?', 'Jetzt klappt es.'])
  })

  it('passes the deck context block and the locale instructions as instructions', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Magier-Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    const conversationId = createConversation(db, 'user-a', { deckId: deck.id }).id
    const { model, calls } = scriptedModel([text('ok')])

    await runTurn(conversationId, model, { locale: 'en', cardLocale: 'en' })

    const system = systemOf(calls[0]!)
    expect(system).toContain(`Deck ID: ${deck.id}`)
    expect(system.endsWith(`${REPLY_LANGUAGE_INSTRUCTION.en}\n\n${CARD_NAME_INSTRUCTION.en}`)).toBe(true)
    expect(calls[0]!.headers?.['x-opencode-session']).toBe(conversationId)
    // The deck-linked conversation keeps its title.
    expect(db.select().from(schema.assistantConversation).get()!.title).toBe('Deck: Magier-Deck')
  })

  it('adds no deck block to an unlinked conversation', async () => {
    createDeck(db, 'user-a', { name: 'Magier-Deck', description: null })
    const { model, calls } = scriptedModel([text('ok')])

    await runTurn(newConversation(), model)

    expect(systemOf(calls[0]!)).not.toContain('Deck ID:')
    expect(systemOf(calls[0]!)).toContain('Deck building:')
  })

  it('saves the fallback texts in the turn\'s interface language', async () => {
    const conversationId = newConversation()
    const { model } = scriptedModel([text('', 'content-filter')])

    await runTurn(conversationId, model)
    await runTurn(conversationId, model, { body: userText('hello'), locale: 'en' })

    expect(storedMessages(conversationId).filter(row => row.role === 'assistant').map(row => row.content))
      .toEqual([TURN_TEXT.de.noAnswer, TURN_TEXT.en.noAnswer])
  })

  it('passes the card language to the tools: German names in the results only in German (ADR 0015)', async () => {
    seedGermanNames(db, { [CARD.darkMagician]: 'Dunkler Magier' })
    const { model, calls } = scriptedModel([call('search_catalog', { query: 'Dunkler' }), text('ok')])

    await runTurn(newConversation(), model, { locale: 'en', cardLocale: 'de' })
    const german = toolResultsOf(calls[1]!)[0]
    calls.length = 0
    await runTurn(newConversation(), model, { locale: 'de', cardLocale: 'en' })
    const english = toolResultsOf(calls[1]!)[0]

    expect(german).toMatchObject({ output: { type: 'json', value: { items: [{ name: 'Dark Magician', nameDe: 'Dunkler Magier' }] } } })
    expect(JSON.stringify(english)).toContain('Dark Magician')
    expect(JSON.stringify(english)).not.toContain('nameDe')
  })
})

describe('the fake model end-to-end (NUXT_ASSISTANT_PROVIDER=fake)', () => {
  it('searches, then adds the found card as a pending action, across two turns', async () => {
    const conversationId = newConversation()
    const fake = createFakeLanguageModel()

    await runTurn(conversationId, fake, { body: userText('suche Dark Magician') })
    expect(storedMessages(conversationId).at(-1)!.content).toBe('Ich habe 1 Karte gefunden: Dark Magician')

    await runTurn(conversationId, fake, { body: userText('füge 2 hinzu') })
    expect(storedMessages(conversationId).at(-1)!.content).toBe('Ich habe einen Vorschlag angelegt.')
    const action = db.select().from(schema.assistantAction).get()!
    expect(action.payload).toMatchObject({ items: [{ catalogCardId: CARD.darkMagician, quantity: 2 }] })

    const messages = loadUiMessages(db, 'user-a', conversationId)
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages[3]!.parts.find(part => part.type === 'data-action')).toMatchObject({ data: { id: action.id, status: 'pending' } })
  })

  it('answers from the deck context of a deck-linked conversation', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Magier-Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    const conversationId = createConversation(db, 'user-a', { deckId: deck.id }).id

    await runTurn(conversationId, createFakeLanguageModel(), { body: userText('Was ist in meinem Deck?') })

    expect(storedMessages(conversationId).at(-1)!.content).toBe('Kontext-Deck: Magier-Deck (2 Karten)')
  })

  it('ends a "leere argumente" turn with a text answer instead of looping (#54)', async () => {
    const conversationId = newConversation()
    await runTurn(conversationId, createFakeLanguageModel(), { body: userText('leere argumente bitte') })
    expect(storedMessages(conversationId).at(-1)!.content).toBe('Ich kann das Werkzeug gerade nicht nutzen.')
  })

  it('notes the picked model in the answer\'s metadata: streamed with the start, stored, and read back', async () => {
    const conversationId = newConversation()
    const { chunks } = await runTurn(conversationId, createFakeLanguageModel('glm-5.3-flash'), { body: userText('Hallo') })
    expect(chunks.find(chunk => chunk.type === 'start')).toMatchObject({ messageMetadata: { model: 'glm-5.3-flash' } })
    const stored = storedMessages(conversationId).at(-1)!
    expect(stored.metadata).toEqual({ model: 'glm-5.3-flash' })
    expect(loadUiMessages(db, 'user-a', conversationId).at(-1)!.metadata).toMatchObject({ model: 'glm-5.3-flash' })
  })

  it('streams a slow "langsame antwort" word by word, so a cancel can stop it midway', async () => {
    const conversationId = newConversation()
    const controller = new AbortController()
    const turn = runTurn(conversationId, createFakeLanguageModel(), { body: userText('langsame antwort'), signal: controller.signal })
    setTimeout(() => controller.abort(), 1500)
    await turn
    const content = storedMessages(conversationId).at(-1)!.content
    expect(content).toMatch(/^Wort1 Wort2 .*\(abgebrochen\)$/)
    expect(content).not.toContain('Wort60')
  })

  it('recovers from a "text-werkzeug" answer with one continuation (#54)', async () => {
    const conversationId = newConversation()
    await runTurn(conversationId, createFakeLanguageModel(), { body: userText('text-werkzeug') })
    const parts = assistantParts(conversationId)
    expect(parts.filter(part => part.type === 'tool-search_catalog')).toHaveLength(1)
    expect(storedMessages(conversationId).at(-1)!.content).toContain('Ich habe 1 Karte gefunden.')
  })
})

describe('#54 helpers', () => {
  it('detects tool calls written as text, and nothing else', () => {
    expect(detectTextWrittenToolCall('search_catalog {"query":"x"}')).toBe(true)
    expect(detectTextWrittenToolCall('Ich rufe get_deck(id="1") auf')).toBe(true)
    expect(detectTextWrittenToolCall('{"name": "create_deck", "arguments": {}}')).toBe(true)
    expect(detectTextWrittenToolCall('<tool_call>{}</tool_call>')).toBe(true)
    expect(detectTextWrittenToolCall('Ich habe search_catalog benutzt und 3 Karten gefunden.')).toBe(false)
    expect(detectTextWrittenToolCall('Dark Magician (ATK 2500)')).toBe(false)
  })

  it('turns the SDK\'s rendering of failed tool calls into their plain error text for the model', () => {
    const invalid = new InvalidToolInputError({ toolName: 'search_catalog', toolInput: '{}', cause: new TypeValidationError({ value: {}, cause: new AssistantToolError(TOOL_TEXT.emptyArguments) }) })
    const steps = [{ content: [
      { type: 'tool-error', toolCallId: '1', toolName: 'get_deck', input: {}, error: new AssistantToolError('Deck not found') },
      { type: 'tool-error', toolCallId: '2', toolName: 'search_catalog', input: {}, error: invalid },
      { type: 'tool-error', toolCallId: '3', toolName: 'nope', input: {}, error: new NoSuchToolError({ toolName: 'nope' }) },
    ] }]
    const messages = cleanToolErrorOutputs([
      { role: 'user', content: 'x' },
      { role: 'tool', content: [
        { type: 'tool-result', toolCallId: '1', toolName: 'get_deck', output: { type: 'error-text', value: 'AssistantToolError: Deck not found' } },
        { type: 'tool-result', toolCallId: '2', toolName: 'search_catalog', output: { type: 'error-text', value: invalid.message } },
        { type: 'tool-result', toolCallId: '3', toolName: 'nope', output: { type: 'error-json', value: {} } },
        { type: 'tool-result', toolCallId: '4', toolName: 'get_card', output: { type: 'json', value: { id: 1 } } },
      ] },
    ], steps)
    expect(messages[1]).toMatchObject({ content: [
      { output: { type: 'error-text', value: 'Deck not found' } },
      { output: { type: 'error-text', value: TOOL_TEXT.emptyArguments } },
      { output: { type: 'error-text', value: TOOL_TEXT.unknownTool('nope') } },
      { output: { type: 'json', value: { id: 1 } } },
    ] })
    const untouched: Parameters<typeof cleanToolErrorOutputs>[0] = [{ role: 'user', content: 'x' }]
    expect(cleanToolErrorOutputs(untouched, [])).toBe(untouched)
  })
})
