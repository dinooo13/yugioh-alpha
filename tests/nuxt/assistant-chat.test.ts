import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
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
    expect(() => validateAssistantMessageInput({ text: 'x'.repeat(4001) })).toThrowError()
  })

  it('rejects more than 3 images', () => {
    const images = Array.from({ length: 4 }, () => 'data:image/png;base64,abc')
    expect(() => validateAssistantMessageInput({ text: 'hi', images })).toThrowError()
  })

  it('rejects a non-data-URL image', () => {
    expect(() => validateAssistantMessageInput({ text: 'hi', images: ['https://example.com/x.png'] })).toThrowError()
  })

  it('accepts images alone without text', () => {
    expect(validateAssistantMessageInput({ images: ['data:image/png;base64,abc'] }).text).toBe('')
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
    expect(JSON.parse(detail.messages[2]!.content)).toEqual([expect.objectContaining({ name: 'Dark Magician' })])
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

    // 8 rounds, each with a tool call — the model is never asked a 9th time.
    expect(calls).toHaveLength(8)
    expect(events.filter(event => event.type === 'tool_call')).toHaveLength(8)
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
    for (let i = 0; i < 35; i++) {
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
    // 30 prior messages (of 35) plus the current turn's user message.
    expect(sentMessages).toHaveLength(31)
    const sentText = JSON.stringify(sentMessages)
    expect(sentText).not.toContain('old message 0"')
    expect(sentText).not.toContain('old message 4"')
    expect(sentText).toContain('old message 34')
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
