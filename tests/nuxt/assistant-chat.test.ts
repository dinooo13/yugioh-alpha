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
} from '../../server/utils/assistant-chat'
import type { AssistantMessageInput, ChatTurnEvent } from '../../server/utils/assistant-chat'
import { getAssistantLimits } from '../../server/utils/assistant-limits'

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
    generate: async () => { throw new Error('generate() not used by the chat engine') },
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
    expect(toolCallEvent).toMatchObject({ name: 'search_catalog', label: expect.stringContaining('Dark Magician') })
    const toolResultEvent = events.find(event => event.type === 'tool_result')
    expect(toolResultEvent).toMatchObject({ ok: true })

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
    expect(toolResultEvent).toMatchObject({ ok: false })
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
      generate: async () => { throw new Error('not used') },
      chat: async () => {
        throw Object.assign(new Error('down'), { statusCode: 502, statusMessage: 'Der KI-Assistent ist derzeit nicht erreichbar.' })
      },
    }
    const conversation = createConversation(db, 'user-a')
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'hallo', images: NO_IMAGES }, model, emit)

    expect(events.map(event => event.type)).toEqual(['message_start', 'error'])
    expect(events[1]).toMatchObject({ message: 'Der KI-Assistent ist derzeit nicht erreichbar.' })

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
      generate: async () => { throw new Error('not used') },
      chat: async () => {
        throw Object.assign(new Error('down'), { statusCode: 502, statusMessage: 'Der KI-Assistent ist derzeit nicht erreichbar.' })
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

  it('runs a tool with a German error result instead of {} when the accumulated arguments are invalid JSON', async () => {
    const conversation = createConversation(db, 'user-a')
    const { model } = scriptedChatModel([
      { text: '', toolCalls: [{ id: 'call-1', name: 'search_catalog', arguments: '{"query": "Dark' }], finishReason: 'tool_calls' },
      textResult('ok'),
    ])
    const { events, emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'suche', images: NO_IMAGES }, model, emit)

    const toolResultEvent = events.find(event => event.type === 'tool_result')
    expect(toolResultEvent).toMatchObject({ ok: false, summary: 'Ungültige Argumente' })

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    const toolMessage = detail.messages.find(message => message.role === 'tool')!
    expect(JSON.parse(toolMessage.content)).toEqual({ error: 'Ungültige Argumente' })
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
    const { emit } = collectEvents()

    await runChatTurn(db, 'user-a', conversation.id, { text: 'details bitte', images: NO_IMAGES }, model, emit)

    const detail = getConversationDetail(db, 'user-a', conversation.id)
    const toolMessage = detail.messages.find(message => message.role === 'tool')!
    // Must stay valid, parseable JSON — never a mid-string cut.
    expect(JSON.parse(toolMessage.content)).toEqual({ error: 'Ergebnis zu groß', hint: 'Bitte enger suchen.' })
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
