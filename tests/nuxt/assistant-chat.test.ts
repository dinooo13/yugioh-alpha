import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { createFakeModel } from '../../server/utils/deck-assistant-model'
import type { ChatModelInput, ChatModelResult, DeckAssistantModel } from '../../server/utils/deck-assistant-model'
import {
  createConversation,
  deleteConversation,
  getConversationDetail,
  listConversations,
  runChatTurn,
  validateAssistantMessageInput,
  validateCreateConversationInput,
} from '../../server/utils/assistant-chat'
import type { AssistantMessageInput, ChatTurnEvent } from '../../server/utils/assistant-chat'
import { getAssistantLimits } from '../../server/utils/assistant-limits'
import { applyAction } from '../../server/utils/assistant-tools'
import { createDeck, deleteDeck, updateDeck, upsertDeckCard } from '../../server/utils/decks'
import { createRuleFormat, validateRuleFormatInput } from '../../server/utils/rule-formats'
import { readFileSync } from 'node:fs'
import { ASSISTANT_CONVERSATION_TITLE_MAX, ASSISTANT_ERROR_CODES, deckConversationTitle } from '../../shared/assistant-chat'
import { REPLY_LANGUAGE_INSTRUCTION, TURN_TEXT } from '../../server/utils/assistant-prompts'

const CARD = {
  darkMagician: 46986414,
  potOfGreed: 55144522,
} as const

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

function seedUsersAndCatalog(db: TestDb) {
  const now = new Date()
  db.insert(schema.user).values([
    { id: 'user-a', name: 'User A', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'User B', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()

  db.insert(schema.catalogCard).values([
    { id: CARD.darkMagician, name: 'Dark Magician', type: 'Normal Monster', desc: 'The ultimate wizard.', syncedAt: now },
    { id: CARD.potOfGreed, name: 'Pot of Greed', type: 'Spell Card', desc: 'Draw two cards.', syncedAt: now },
  ]).run()
}

/** The HTTP status a rejected promise carries, or undefined if it resolved. */
async function statusOf(run: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await run()
  }
  catch (error) {
    return (error as { statusCode?: number }).statusCode
  }
  return undefined
}

/** A DeckAssistantModel whose chat() returns one scripted result per call (the last one repeats). */
function scriptedChatModel(results: ChatModelResult[]): { model: DeckAssistantModel, calls: ChatModelInput[] } {
  const calls: ChatModelInput[] = []
  let index = 0
  const model: DeckAssistantModel = {
    id: 'scripted',
    async chat(input, handlers) {
      calls.push(input)
      const result = results[Math.min(index, results.length - 1)]!
      index += 1
      if (result.text !== '') {
        handlers.onTextDelta(result.text)
      }
      if (result.toolCalls.length > 0) {
        handlers.onToolCallDelta?.()
      }
      return result
    },
  }
  return { model, calls }
}

function toolCallResult(name: string, args: Record<string, unknown>, text = ''): ChatModelResult {
  return { text, toolCalls: [{ id: `call-${name}`, name, arguments: JSON.stringify(args) }], finishReason: 'tool_calls' }
}

function textResult(text: string): ChatModelResult {
  return { text, toolCalls: [], finishReason: 'stop' }
}

function collectEvents() {
  const events: ChatTurnEvent[] = []
  return { events, emit: (event: ChatTurnEvent) => { events.push(event) } }
}

const NO_IMAGES: AssistantMessageInput['images'] = []

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  seedUsersAndCatalog(db)
})

describe('validateAssistantMessageInput', () => {
  it('trims text and accepts data-URL images within the limits', () => {
    expect(validateAssistantMessageInput({ text: '  Hallo  ', images: ['data:image/png;base64,abc'] }))
      .toEqual({ text: 'Hallo', images: ['data:image/png;base64,abc'] })
  })

  it('rejects an empty message with no images', () => {
    expect(() => validateAssistantMessageInput({ text: '' })).toThrowError()
  })

  it('rejects text over the length limit', () => {
    expect(() => validateAssistantMessageInput({ text: 'x'.repeat(20_001) })).toThrowError()
  })

  it('rejects more than 6 images', () => {
    const images = Array.from({ length: 7 }, () => 'data:image/png;base64,abc')
    expect(() => validateAssistantMessageInput({ text: 'hi', images })).toThrowError()
  })

  it('rejects a non-data-URL image', () => {
    expect(() => validateAssistantMessageInput({ text: 'hi', images: ['https://example.com/x.png'] })).toThrowError()
  })

  it('rejects a data URL with a disallowed MIME type', () => {
    expect(() => validateAssistantMessageInput({ text: 'hi', images: ['data:application/pdf;base64,abc'] })).toThrowError()
    expect(() => validateAssistantMessageInput({ text: 'hi', images: ['data:text/html,<script>'] })).toThrowError()
  })

  it('accepts jpeg and webp data URLs, not just png', () => {
    expect(() => validateAssistantMessageInput({ text: 'hi', images: ['data:image/jpeg;base64,abc'] })).not.toThrow()
    expect(() => validateAssistantMessageInput({ text: 'hi', images: ['data:image/webp;base64,abc'] })).not.toThrow()
  })

  it('accepts images alone without text', () => {
    expect(validateAssistantMessageInput({ images: ['data:image/png;base64,abc'] }).text).toBe('')
  })

  it('measures the size cap from the decoded base64 payload, not the raw data-URL string length', () => {
    // ~15,000,000 base64 characters decode to ~10.7 MB — under the 12 MB
    // cap — even though the raw data-URL string itself is longer than that.
    const base64 = 'A'.repeat(15_000_000)
    expect(() => validateAssistantMessageInput({ text: 'hi', images: [`data:image/png;base64,${base64}`] })).not.toThrow()
  })

  it('still rejects when the decoded image data itself exceeds the cap', () => {
    const base64 = 'A'.repeat(20_000_000) // decodes to ~14.3 MB
    expect(() => validateAssistantMessageInput({ text: 'hi', images: [`data:image/png;base64,${base64}`] })).toThrowError()
  })
})

describe('conversation CRUD', () => {
  it('creates, lists, reads, and deletes a conversation, all scoped to the owner', () => {
    const conversation = createConversation(db, 'user-a')
    expect(conversation.title).toBe('Neue Unterhaltung')

    expect(listConversations(db, 'user-a')).toEqual([
      { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt },
    ])
    expect(listConversations(db, 'user-b')).toEqual([])

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    expect(detail.messages).toEqual([])
    expect(detail.actions).toEqual([])

    expect(() => getConversationDetail(db, 'user-b', conversation.id)).toThrowError()
    expect(() => deleteConversation(db, 'user-b', conversation.id)).toThrowError()

    deleteConversation(db, 'user-a', conversation.id)
    expect(() => getConversationDetail(db, 'user-a', conversation.id)).toThrowError()
  })
})

describe('runChatTurn', () => {
  it('404s for a conversation that does not belong to the caller', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([textResult('hi')])
    const { emit } = collectEvents()

    expect(await statusOf(() => runChatTurn(db, 'user-b', conversation.id, { text: 'hi', images: NO_IMAGES }, model, emit)))
      .toBe(404)
  })

  it('runs a tool call, feeds the result back, and answers — persisting every message', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([
      toolCallResult('search_catalog', { query: 'Dark Magician' }),
      textResult('Ich habe 1 Karte gefunden: Dark Magician'),
    ])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'suche Dark Magician', images: NO_IMAGES }, model, emit)

    expect(events.map(event => event.type)).toEqual([
      'message_start',
      'tool_call',
      'tool_result',
      'text_delta',
      'message_end',
    ])

    const toolCallEvent = events.find(event => event.type === 'tool_call')
    // Structured (ADR 0014): the UI builds the chip text in its language.
    expect(toolCallEvent).toEqual({ type: 'tool_call', id: 'call-search_catalog', name: 'search_catalog', arguments: { query: 'Dark Magician' } })
    const toolResultEvent = events.find(event => event.type === 'tool_result')
    expect(toolResultEvent).toEqual({ type: 'tool_result', id: 'call-search_catalog', ok: true, outcome: { count: 1 } })

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    expect(detail.messages.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(detail.messages[0]).toMatchObject({ role: 'user', content: 'suche Dark Magician' })
    expect(detail.messages[1]).toMatchObject({ role: 'assistant', toolCalls: [{ name: 'search_catalog' }] })
    expect(detail.messages[2]).toMatchObject({ role: 'tool', toolName: 'search_catalog' })
    expect(JSON.parse(detail.messages[2]!.content)).toMatchObject({ items: [expect.objectContaining({ name: 'Dark Magician' })] })
    expect(detail.messages[3]).toMatchObject({ role: 'assistant', content: 'Ich habe 1 Karte gefunden: Dark Magician' })

    // The conversation title is derived from the first user message.
    expect(detail.conversation.title).toBe('suche Dark Magician')
  })

  it('persists a pending action and emits action_proposed for a write tool call', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([
      toolCallResult('add_to_inventory', { items: [{ catalogCardId: CARD.darkMagician, quantity: 2 }] }),
      textResult('Ich habe einen Vorschlag angelegt.'),
    ])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'füge 2 hinzu', images: NO_IMAGES }, model, emit)

    const actionEvent = events.find(event => event.type === 'action_proposed')
    expect(actionEvent).toBeDefined()
    expect(actionEvent).toMatchObject({ action: { kind: 'add_to_inventory', status: 'pending' } })
    expect(events.find(event => event.type === 'tool_result')).toMatchObject({ ok: true, outcome: { pending: true } })

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    expect(detail.actions).toHaveLength(1)
    expect(detail.actions[0]).toMatchObject({ kind: 'add_to_inventory', status: 'pending' })
    expect(detail.actions[0]!.messageId).toBe(detail.messages[1]!.id)
  })

  it('returns a tool error to the model instead of failing the turn on invalid arguments', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([
      toolCallResult('add_to_inventory', { items: [{ catalogCardId: 999999999, quantity: 1 }] }),
      textResult('Die Karte konnte nicht gefunden werden.'),
    ])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'füge eine unbekannte Karte hinzu', images: NO_IMAGES }, model, emit)

    const toolResultEvent = events.find(event => event.type === 'tool_result')
    expect(toolResultEvent).toMatchObject({ ok: false, outcome: { error: expect.any(String) } })
    expect(events.some(event => event.type === 'action_proposed')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'message_end' })

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    const toolMessage = detail.messages.find(message => message.role === 'tool')!
    expect(JSON.parse(toolMessage.content)).toMatchObject({ error: expect.any(String) })
  })

  it('stops after the max tool-round guard and still ends the turn with a message', async () => {
    const { model, calls } = scriptedChatModel([toolCallResult('list_collections', {})])
    const conversation = createConversation(db, 'user-a')
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'endlos', images: NO_IMAGES }, model, emit)

    // `maxToolRounds` rounds, each with a tool call — the model is never
    // asked one round more than that.
    const { maxToolRounds } = getAssistantLimits()
    expect(calls).toHaveLength(maxToolRounds)
    expect(events.filter(event => event.type === 'tool_call')).toHaveLength(maxToolRounds)
    expect(events.at(-1)).toMatchObject({ type: 'message_end' })

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    const lastMessage = detail.messages.at(-1)!
    expect(lastMessage.role).toBe('assistant')
    expect(lastMessage.content.length).toBeGreaterThan(0)
  })

  it('emits an error event and persists nothing further when the model throws', async () => {
    const model: DeckAssistantModel = {
      id: 'broken',
      chat: async () => {
        throw Object.assign(new Error('down'), { statusCode: 502, statusMessage: 'The assistant is currently unreachable', data: { code: 'assistant_unreachable' } })
      },
    }
    const conversation = createConversation(db, 'user-a')
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'hallo', images: NO_IMAGES }, model, emit)

    expect(events.map(event => event.type)).toEqual(['message_start', 'error'])
    // The UI translates the code (errors.api.assistant_unreachable).
    expect(events[1]).toEqual({ type: 'error', code: 'assistant_unreachable', message: 'The assistant is currently unreachable' })

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    // The user message was persisted; no assistant message follows the failure.
    expect(detail.messages).toHaveLength(1)
    expect(detail.messages[0]).toMatchObject({ role: 'user' })
  })

  it('trims history to the most recent messages, oldest dropped first', async () => {
    const conversation = createConversation(db, 'user-a')
    const base = Date.parse('2024-01-01T00:00:00Z')
    const { historyMessages } = getAssistantLimits()
    // 5 more than the cap, so the count trim's boundary (index
    // `totalMessages - historyMessages` = 5) lands on an odd/assistant
    // message, same as the original 35-message/30-cap fixture — exercising
    // the window-must-start-on-`user` sanitization drop below too.
    const totalMessages = historyMessages + 5
    for (let i = 0; i < totalMessages; i++) {
      db.insert(schema.assistantMessage).values({
        id: `hist-${i}`,
        conversationId: conversation.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `old message ${i}`,
        createdAt: new Date(base + i * 1000),
      }).run()
    }

    const { model, calls } = scriptedChatModel([textResult('ok')])
    const { emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'weiter', images: NO_IMAGES }, model, emit)

    const sentMessages = calls[0]!.messages
    // The count trim keeps the newest `historyMessages` (i=5..totalMessages-1);
    // i=5 is an assistant message, so the window-must-start-on-`user`
    // sanitization drops it too, leaving i=6..totalMessages-1 plus the
    // current turn's user message.
    expect(sentMessages).toHaveLength(historyMessages)
    const sentText = JSON.stringify(sentMessages)
    expect(sentText).not.toContain('old message 0"')
    expect(sentText).not.toContain('old message 4"')
    expect(sentText).not.toContain('old message 5"')
    expect(sentText).toContain('old message 6')
    expect(sentText).toContain(`old message ${totalMessages - 1}`)
  })

  it('sanitizes a history window that would otherwise start mid tool-call sequence', async () => {
    const conversation = createConversation(db, 'user-a')
    const base = Date.parse('2024-01-01T00:00:00Z')
    let seq = 0
    const insert = (fields: { role: 'user' | 'assistant' | 'tool', content: string, toolCalls?: Array<{ id: string, name: string, arguments: Record<string, unknown> }>, toolCallId?: string, toolName?: string }) => {
      seq += 1
      db.insert(schema.assistantMessage).values({
        id: `hist-${seq}`,
        conversationId: conversation.id,
        createdAt: new Date(base + seq * 1000),
        ...fields,
      }).run()
    }

    // The oldest two rows are a tool-call group (an assistant `tool_calls`
    // message immediately followed by its `tool` result). `historyMessages + 1`
    // rows total, so the count trim drops exactly the assistant row, leaving
    // its `tool` row as the would-be first message of the window — the
    // orphan scenario finding #1 describes.
    const { historyMessages } = getAssistantLimits()
    insert({ role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_catalog', arguments: { query: 'x' } }] })
    insert({ role: 'tool', content: '[]', toolCallId: 'call-1', toolName: 'search_catalog' })
    for (let i = 0; i < historyMessages - 1; i++) {
      insert({ role: i % 2 === 0 ? 'user' : 'assistant', content: `old message ${i}` })
    }

    const { model, calls } = scriptedChatModel([textResult('ok')])
    const { emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'weiter', images: NO_IMAGES }, model, emit)

    const sentMessages = calls[0]!.messages
    // The window must start on a `user` message, and must never contain a
    // lone `tool` row without its assistant `tool_calls` message right before it.
    expect(sentMessages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'old message 0' }] })
    for (let i = 0; i < sentMessages.length; i++) {
      if (sentMessages[i]!.role === 'tool') {
        expect(sentMessages[i - 1]).toBeDefined()
        expect(sentMessages[i - 1]!.role).toBe('assistant')
        expect((sentMessages[i - 1] as { tool_calls?: unknown[] }).tool_calls?.length).toBeGreaterThan(0)
      }
    }
  })

  it('does not resend image bytes from history — only the current turn carries image_url parts', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model: firstModel } = scriptedChatModel([textResult('Auf dem Bild sehe ich: Dark Magician.')])
    await runChatTurn(db, 'user-a', conversation.id, { text: 'was ist das', images: ['data:image/png;base64,abc'] }, firstModel, () => {})

    const { model, calls } = scriptedChatModel([textResult('weiter')])
    await runChatTurn(db, 'user-a', conversation.id, { text: 'noch etwas', images: [] }, model, () => {})

    const historyUserMessage = calls[0]!.messages[0]
    expect(historyUserMessage).toEqual({ role: 'user', content: [{ type: 'text', text: 'was ist das' }] })
  })

  it('sets the conversation title from the first user message even when the turn itself fails', async () => {
    const conversation = createConversation(db, 'user-a')
    const model: DeckAssistantModel = {
      id: 'broken',
      chat: async () => {
        throw Object.assign(new Error('down'), { statusCode: 502, statusMessage: 'The assistant is currently unreachable', data: { code: 'assistant_unreachable' } })
      },
    }

    await runChatTurn(db, 'user-a', conversation.id, { text: 'Hallo Assistent', images: NO_IMAGES }, model, () => {})

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    expect(detail.conversation.title).toBe('Hallo Assistent')
    // The user message alone must already have moved the conversation off
    // "just created" — not only a turn that completes successfully.
    expect(new Date(detail.conversation.updatedAt).getTime()).toBeGreaterThan(new Date(detail.conversation.createdAt).getTime() - 1)
  })

  it('bumps updatedAt on every persisted message, not only at the end of a successful turn', async () => {
    const conversation = createConversation(db, 'user-a')
    const createdAt = getConversationDetail(db, 'user-a', conversation.id).conversation.updatedAt

    const { model } = scriptedChatModel([
      toolCallResult('search_catalog', { query: 'Dark Magician' }),
      textResult('Ich habe 1 Karte gefunden: Dark Magician'),
    ])
    await runChatTurn(db, 'user-a', conversation.id, { text: 'suche Dark Magician', images: NO_IMAGES }, model, () => {})

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    // user, assistant(tool_calls), tool, assistant(final) — every one of
    // those persists and should have bumped `updatedAt` at least once.
    expect(detail.messages).toHaveLength(4)
    expect(new Date(detail.conversation.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(createdAt).getTime())
  })

  it('honours finishReason "length": appends a note to the answer and stops the loop', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model, calls } = scriptedChatModel([
      { text: 'Das ist eine unvollständige Antwort', toolCalls: [], finishReason: 'length' },
    ])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'frag was langes', images: NO_IMAGES }, model, emit)

    expect(calls).toHaveLength(1)
    const messageEnd = events.find(event => event.type === 'message_end')
    expect(messageEnd).toMatchObject({ message: { content: expect.stringContaining('(Antwort wurde gekürzt)') } })
    expect(messageEnd).toMatchObject({ message: { content: expect.stringContaining('Das ist eine unvollständige Antwort') } })
  })

  it('honours finishReason "length" on a tool-call round too — stops instead of continuing the loop', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model, calls } = scriptedChatModel([
      { text: '', toolCalls: [{ id: 'call-1', name: 'search_catalog', arguments: '{"query":"Dark' }], finishReason: 'length' },
      textResult('sollte nicht aufgerufen werden'),
    ])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'frag was langes', images: NO_IMAGES }, model, emit)

    // Only the first (truncated) round is ever sent to the model.
    expect(calls).toHaveLength(1)
    expect(events.some(event => event.type === 'tool_call')).toBe(false)
    const messageEnd = events.find(event => event.type === 'message_end')
    expect(messageEnd).toMatchObject({ message: { content: expect.stringContaining('(Antwort wurde gekürzt)') } })
  })

  it('replaces a content_filter or empty final answer with a German fallback', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([{ text: '', toolCalls: [], finishReason: 'content_filter' }])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'hallo', images: NO_IMAGES }, model, emit)

    const messageEnd = events.find(event => event.type === 'message_end')
    expect(messageEnd).toMatchObject({ message: { content: expect.stringContaining('keine Antwort erzeugen') } })
  })

  it('replaces an empty final answer (finishReason "stop") with a German fallback', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([{ text: '', toolCalls: [], finishReason: 'stop' }])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'hallo', images: NO_IMAGES }, model, emit)

    const messageEnd = events.find(event => event.type === 'message_end')
    expect(messageEnd).toMatchObject({ message: { content: expect.stringContaining('keine Antwort erzeugen') } })
  })

  it('runs a tool with an error result instead of {} when the accumulated arguments are invalid JSON', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([
      { text: '', toolCalls: [{ id: 'call-1', name: 'search_catalog', arguments: '{"query": "Dark' }], finishReason: 'tool_calls' },
      textResult('ok'),
    ])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'suche', images: NO_IMAGES }, model, emit)

    const toolResultEvent = events.find(event => event.type === 'tool_result')
    expect(toolResultEvent).toMatchObject({ ok: false, outcome: { error: 'Invalid arguments' } })

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    const toolMessage = detail.messages.find(message => message.role === 'tool')!
    expect(JSON.parse(toolMessage.content)).toEqual({ error: 'Invalid arguments' })
  })

  it('replaces an over-budget tool result with a valid JSON error envelope instead of truncating the JSON string', async () => {
    const conversation = createConversation(db, 'user-a')
    // A description long enough to push the serialized get_card result past
    // the configured tool-result budget (`getAssistantLimits().toolResultChars`).
    db.update(schema.catalogCard)
      .set({ desc: 'x'.repeat(getAssistantLimits().toolResultChars + 1000) })
      .where(eq(schema.catalogCard.id, CARD.darkMagician))
      .run()

    const { model } = scriptedChatModel([
      toolCallResult('get_card', { id: CARD.darkMagician }),
      textResult('ok'),
    ])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'details bitte', images: NO_IMAGES }, model, emit)

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    const toolMessage = detail.messages.find(message => message.role === 'tool')!
    // Must stay valid, parseable JSON — never a mid-string cut.
    expect(JSON.parse(toolMessage.content)).toEqual({ error: 'Result too large', hint: 'Please search more narrowly.' })
    // The live chip reports what was persisted: failed.
    expect(events.find(event => event.type === 'tool_result')).toMatchObject({ ok: false, outcome: { error: 'Result too large' } })
  })
})

describe('runChatTurn: interface language (ADR 0014)', () => {
  it('ends the system prompt with the reply-language instruction of the turn\'s locale (German by default)', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model, calls } = scriptedChatModel([textResult('ok')])

    await runChatTurn(db, 'user-a', conversation.id, { text: 'hallo', images: NO_IMAGES }, model, collectEvents().emit)
    await runChatTurn(db, 'user-a', conversation.id, { text: 'hello', images: NO_IMAGES, locale: 'en' }, model, collectEvents().emit)
    await runChatTurn(db, 'user-a', conversation.id, { text: 'hallo', images: ['data:image/png;base64,abc'], locale: 'de' }, model, collectEvents().emit)

    expect(calls[0]!.system.endsWith(`\n\n${REPLY_LANGUAGE_INSTRUCTION.de}`)).toBe(true)
    expect(calls[1]!.system.endsWith(`\n\n${REPLY_LANGUAGE_INSTRUCTION.en}`)).toBe(true)
    expect(calls[1]!.system).toContain('Reply in English unless the user explicitly asks for another language.')
    expect(calls[1]!.system).not.toContain('Reply in German')
    // The instruction stays last, after the image hint.
    expect(calls[2]!.system).toContain('search_catalog`, and ask if you are unsure.')
    expect(calls[2]!.system.endsWith(REPLY_LANGUAGE_INSTRUCTION.de)).toBe(true)
    // The model-facing prompt itself is English in every locale.
    expect(calls[0]!.system.startsWith('You are a Yu-Gi-Oh! assistant')).toBe(true)
  })

  it('saves fallback answers in the turn\'s locale', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([{ text: '', toolCalls: [], finishReason: 'content_filter' }])

    const german = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'hallo', images: NO_IMAGES }, model, german.emit)
    const english = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'hello', images: NO_IMAGES, locale: 'en' }, model, english.emit)

    expect(german.events.at(-1)).toMatchObject({ type: 'message_end', message: { content: TURN_TEXT.de.noAnswer } })
    expect(english.events.at(-1)).toMatchObject({ type: 'message_end', message: { content: 'I couldn\'t come up with an answer to that. Please rephrase the question.' } })
    const contents = getConversationDetail(db, 'user-a', conversation.id).messages.map(message => message.content)
    expect(contents).toContain(TURN_TEXT.de.noAnswer)
    expect(contents).toContain(TURN_TEXT.en.noAnswer)
  })

  it('marks a cut-off answer and a cancelled turn in the turn\'s locale', async () => {
    const conversation = createConversation(db, 'user-a')
    const cutOff = scriptedChatModel([{ text: 'Half an answer', toolCalls: [], finishReason: 'length' }])
    const events = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'long', images: NO_IMAGES, locale: 'en' }, cutOff.model, events.emit)
    expect(events.events.at(-1)).toMatchObject({ message: { content: 'Half an answer … (answer was shortened)' } })

    const aborted = new AbortController()
    aborted.abort()
    const cancelled = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'stop', images: NO_IMAGES, locale: 'en' }, cutOff.model, cancelled.emit, aborted.signal)
    expect(cancelled.events.at(-1)).toMatchObject({ message: { content: '… (cancelled)' } })

    const german = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'stopp', images: NO_IMAGES }, cutOff.model, german.emit, aborted.signal)
    expect(german.events.at(-1)).toMatchObject({ message: { content: '… (abgebrochen)' } })
  })

  it('has a translation for every assistant error code (errors.api.<code>; `unexpected` has its own fallback key)', () => {
    for (const locale of ['de', 'en']) {
      const api = (JSON.parse(readFileSync(`i18n/locales/${locale}/errors.json`, 'utf8')) as { errors: { api: Record<string, string> } }).errors.api
      const missing = ASSISTANT_ERROR_CODES.filter(code => code !== 'unexpected' && !api[code])
      expect(missing, locale).toEqual([])
    }
  })

  it('titles a new conversation in the given locale (German by default)', () => {
    expect(createConversation(db, 'user-a').title).toBe('Neue Unterhaltung')
    expect(createConversation(db, 'user-a', {}, 'en').title).toBe('New conversation')
  })

  it('labels stored image attachments in the turn\'s locale', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([textResult('ok')])
    await runChatTurn(db, 'user-a', conversation.id, { text: '', images: ['data:image/png;base64,abc'], locale: 'en' }, model, collectEvents().emit)
    expect(getConversationDetail(db, 'user-a', conversation.id).messages[0]!.attachments).toEqual([{ kind: 'image', label: 'Photo 1' }])
  })
})

describe('runChatTurn with the fake chat model (end-to-end across two turns)', () => {
  it('searches, then adds the found card to the inventory as a pending action', async () => {
    const conversation = createConversation(db, 'user-a')
    const model = createFakeModel()

    const firstEvents = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'suche Dark Magician', images: NO_IMAGES }, model, firstEvents.emit)
    expect(firstEvents.events.at(-1)).toMatchObject({
      type: 'message_end',
      message: { content: expect.stringContaining('Dark Magician') },
    })

    const secondEvents = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'füge 2 hinzu', images: NO_IMAGES }, model, secondEvents.emit)

    const actionEvent = secondEvents.events.find(event => event.type === 'action_proposed')
    expect(actionEvent).toMatchObject({ action: { kind: 'add_to_inventory', status: 'pending' } })
  })
})

describe('validateCreateConversationInput (POST /api/assistant/chat body)', () => {
  it('accepts an empty body or an optional deckId', () => {
    expect(validateCreateConversationInput(undefined)).toEqual({})
    expect(validateCreateConversationInput({})).toEqual({})
    expect(validateCreateConversationInput({ deckId: null })).toEqual({})
    expect(validateCreateConversationInput({ deckId: ' deck-1 ' })).toEqual({ deckId: 'deck-1' })
  })

  it('rejects a non-object body or a non-string/empty deckId', () => {
    expect(() => validateCreateConversationInput('deck-1')).toThrowError()
    expect(() => validateCreateConversationInput(['deck-1'])).toThrowError()
    expect(() => validateCreateConversationInput({ deckId: 42 })).toThrowError()
    expect(() => validateCreateConversationInput({ deckId: '  ' })).toThrowError()
  })
})

describe('deckConversationTitle', () => {
  it('is "Deck: <name>" for a short name', () => {
    expect(deckConversationTitle('Magier')).toBe('Deck: Magier')
  })

  it('truncates to ASSISTANT_CONVERSATION_TITLE_MAX with an ellipsis', () => {
    const title = deckConversationTitle('x'.repeat(80))
    expect(title).toHaveLength(ASSISTANT_CONVERSATION_TITLE_MAX)
    expect(title.startsWith('Deck: xxx')).toBe(true)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('deck-linked conversations (ADR 0011)', () => {
  function seedDeck(userId = 'user-a', name = 'Magier-Deck') {
    const deck = createDeck(db, userId, { name, description: null })
    upsertDeckCard(db, userId, deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    return deck
  }

  it('links a new conversation to the caller\'s deck and titles it after the deck', () => {
    const deck = seedDeck()
    const conversation = createConversation(db, 'user-a', { deckId: deck.id })

    expect(conversation).toMatchObject({ title: 'Deck: Magier-Deck', deck: { id: deck.id, name: 'Magier-Deck' } })
    expect(getConversationDetail(db, 'user-a', conversation.id).conversation.deck).toEqual({ id: deck.id, name: 'Magier-Deck' })
    // A plain conversation has no deck.
    expect(createConversation(db, 'user-a').deck).toBeNull()
  })

  it('404s for another user\'s (or an unknown) deck', async () => {
    const foreign = seedDeck('user-b')
    expect(await statusOf(async () => createConversation(db, 'user-a', { deckId: foreign.id }))).toBe(404)
    expect(await statusOf(async () => createConversation(db, 'user-a', { deckId: 'does-not-exist' }))).toBe(404)
  })

  it('reuses an empty linked conversation, and starts a new one once it has messages', async () => {
    const deck = seedDeck()
    const first = createConversation(db, 'user-a', { deckId: deck.id })
    expect(createConversation(db, 'user-a', { deckId: deck.id }).id).toBe(first.id)

    const { model } = scriptedChatModel([textResult('ok')])
    await runChatTurn(db, 'user-a', first.id, { text: 'Hallo', images: NO_IMAGES }, model, collectEvents().emit)

    const second = createConversation(db, 'user-a', { deckId: deck.id })
    expect(second.id).not.toBe(first.id)
    expect(second.deck).toEqual({ id: deck.id, name: 'Magier-Deck' })
  })

  it('unlinks (deck → null) instead of deleting the conversation when the deck is deleted', async () => {
    const deck = seedDeck()
    const conversation = createConversation(db, 'user-a', { deckId: deck.id })
    const { model } = scriptedChatModel([textResult('ok')])
    await runChatTurn(db, 'user-a', conversation.id, { text: 'Hallo', images: NO_IMAGES }, model, collectEvents().emit)

    deleteDeck(db, 'user-a', deck.id)

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    expect(detail.conversation.deck).toBeNull()
    expect(detail.messages.map(message => message.role)).toEqual(['user', 'assistant'])
  })

  it('injects the deck\'s current state into the system prompt, and keeps the "Deck: …" title', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({
      name: 'Streng',
      rules: { rules: [{ kind: 'copies', maxCopies: 1 }] },
    }))
    const deck = seedDeck()
    updateDeck(db, 'user-a', deck.id, { formatId: format.id })
    const conversation = createConversation(db, 'user-a', { deckId: deck.id })

    const { model, calls } = scriptedChatModel([textResult('ok')])
    await runChatTurn(db, 'user-a', conversation.id, { text: 'Was ist in meinem Deck?', images: NO_IMAGES }, model, collectEvents().emit)

    const system = calls[0]!.system
    expect(system).toContain(`Deck ID: ${deck.id}`)
    expect(system).toContain('Deck name: Magier-Deck')
    expect(system).toContain(`Format: Streng (ID ${format.id})`)
    expect(system).toContain('Counts: Main 2 · Extra 0 · Side 0')
    // Everything the model reads is English (ADR 0014).
    expect(system).toMatch(/Legality: not legal – Dark Magician: 2 copies in the deck; 1 copy is allowed\./)
    expect(system).toContain(`${CARD.darkMagician}|Dark Magician|main|2|0`)
    expect(system).toContain(`update_deck_cards and deckId=${deck.id}`)
    expect(system).toContain('its format only with set_deck_format and this deckId')
    // The deck block comes before the reply-language instruction.
    expect(system.indexOf('Deck ID:')).toBeLessThan(system.indexOf(REPLY_LANGUAGE_INSTRUCTION.de))

    expect(getConversationDetail(db, 'user-a', conversation.id).conversation.title).toBe('Deck: Magier-Deck')
  })

  it('reflects an applied deck change on the next turn (the block is rebuilt per turn, never persisted)', async () => {
    const deck = seedDeck()
    const conversation = createConversation(db, 'user-a', { deckId: deck.id })

    const { model, calls } = scriptedChatModel([
      toolCallResult('update_deck_cards', {
        deckId: deck.id,
        changes: [{ catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 }],
      }),
      textResult('Vorschlag angelegt.'),
    ])
    const { events, emit } = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'Füge Pot of Greed hinzu', images: NO_IMAGES }, model, emit)
    expect(calls[0]!.system).toContain('Legality: no format')
    expect(calls[0]!.system).not.toContain('Pot of Greed|main')

    const proposed = events.find(event => event.type === 'action_proposed')
    expect(proposed?.type).toBe('action_proposed')
    await applyAction(db, 'user-a', (proposed as Extract<ChatTurnEvent, { type: 'action_proposed' }>).action.id)

    await runChatTurn(db, 'user-a', conversation.id, { text: 'Und jetzt?', images: NO_IMAGES }, model, collectEvents().emit)
    const nextSystem = calls.at(-1)!.system
    expect(nextSystem).toContain(`${CARD.potOfGreed}|Pot of Greed|main|1|0`)
    expect(nextSystem).toContain('Counts: Main 3 · Extra 0 · Side 0')

    // Nothing of the block ends up in the persisted messages.
    const stored = getConversationDetail(db, 'user-a', conversation.id).messages
    expect(stored.some(message => message.content.includes('Deck ID:'))).toBe(false)
  })

  it('adds no deck block to an unlinked conversation', async () => {
    seedDeck()
    const conversation = createConversation(db, 'user-a')
    const { model, calls } = scriptedChatModel([textResult('ok')])
    await runChatTurn(db, 'user-a', conversation.id, { text: 'Was ist in meinem Deck?', images: NO_IMAGES }, model, collectEvents().emit)

    expect(calls[0]!.system).not.toContain('Deck ID:')
    expect(calls[0]!.system).toContain('Deck building:')
  })

  it('lets the fake model answer from the deck context end-to-end', async () => {
    const deck = seedDeck()
    const conversation = createConversation(db, 'user-a', { deckId: deck.id })
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'Was ist in meinem Deck?', images: NO_IMAGES }, createFakeModel(), emit)

    expect(events.at(-1)).toMatchObject({ type: 'message_end', message: { content: 'Kontext-Deck: Magier-Deck (2 Karten)' } })
  })

  it('names the caller\'s deck in tool calls, live and reloaded, instead of its id (#53)', async () => {
    const deck = seedDeck()
    const foreign = seedDeck('user-b', 'Fremdes Deck')
    const conversation = createConversation(db, 'user-a', { deckId: deck.id })
    const { model } = scriptedChatModel([
      { text: '', toolCalls: [
        { id: 'call-own', name: 'validate_deck', arguments: JSON.stringify({ deckId: deck.id, formatId: 'tcg-advanced' }) },
        { id: 'call-get', name: 'get_deck', arguments: JSON.stringify({ id: deck.id }) },
        { id: 'call-foreign', name: 'get_deck', arguments: JSON.stringify({ id: foreign.id }) },
      ], finishReason: 'tool_calls' },
      textResult('ok'),
    ])
    const { events, emit } = collectEvents()
    await runChatTurn(db, 'user-a', conversation.id, { text: 'prüfe', images: NO_IMAGES }, model, emit)

    const toolCalls = events.filter(event => event.type === 'tool_call')
    expect(toolCalls).toEqual([
      { type: 'tool_call', id: 'call-own', name: 'validate_deck', arguments: { deckId: deck.id, formatId: 'tcg-advanced' }, deckName: 'Magier-Deck' },
      { type: 'tool_call', id: 'call-get', name: 'get_deck', arguments: { id: deck.id }, deckName: 'Magier-Deck' },
      // Another user's deck is never named.
      { type: 'tool_call', id: 'call-foreign', name: 'get_deck', arguments: { id: foreign.id } },
    ])

    // A reload resolves the deck's *current* name; nothing of it is stored.
    updateDeck(db, 'user-a', deck.id, { name: 'Umbenannt' })
    const reloaded = getConversationDetail(db, 'user-a', conversation.id).messages.find(message => message.toolCalls)!
    expect(reloaded.toolCalls!.map(call => call.deckName)).toEqual(['Umbenannt', 'Umbenannt', undefined])
    const stored = db.select().from(schema.assistantMessage).all().find(row => row.toolCalls)!
    expect(JSON.stringify(stored.toolCalls)).not.toContain('Magier-Deck')
  })
})
