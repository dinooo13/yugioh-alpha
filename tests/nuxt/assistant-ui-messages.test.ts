// Conversation messages as AI SDK UIMessages (server/utils/assistant-ui-messages.ts,
// ADR 0020): the read-time conversion of the former engine's rows, display
// hydration (#53, #69), the history window, and turn request validation.

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { convertToModelMessages } from 'ai'
import * as schema from '../../server/db/schema'
import { createConversation, toActionView } from '../../server/utils/assistant-chat'
import { buildAssistantToolSet } from '../../server/utils/assistant-tools'
import { TOOL_TEXT } from '../../server/utils/assistant-prompts'
import {
  legacyRowsToUIMessages,
  loadUiMessages,
  trimUiHistory,
  validateAssistantTurnRequest,
} from '../../server/utils/assistant-ui-messages'
import { createDeck, updateDeck } from '../../server/utils/decks'
import type { AssistantUIMessage } from '../../shared/assistant-ui'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>
type MessageRow = typeof schema.assistantMessage.$inferSelect

let db: TestDb
let conversationId: string

beforeEach(() => {
  db = createTestDb()
  const now = new Date()
  db.insert(schema.user).values([
    { id: 'user-a', name: 'User A', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'User B', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()
  conversationId = createConversation(db, 'user-a').id
})

let clock = Date.UTC(2026, 0, 1)

/** A stored row of the former engine (parts NULL), timestamped in insertion order. */
function legacyRow(fields: Partial<MessageRow> & Pick<MessageRow, 'id' | 'role'>): MessageRow {
  clock += 1000
  const row: MessageRow = {
    conversationId,
    content: '',
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    attachments: null,
    parts: null,
    metadata: null,
    createdAt: new Date(clock),
    ...fields,
  }
  db.insert(schema.assistantMessage).values(row).run()
  return row
}

/** A legacy conversation shaped like the demo user's: a two-round answer with a proposal, then a follow-up. */
function seedLegacyConversation() {
  const rows = [
    legacyRow({ id: 'u1', role: 'user', content: 'füge Dark Magician hinzu', attachments: [{ kind: 'image', label: 'Foto 1' }] }),
    legacyRow({ id: 'a1', role: 'assistant', content: 'Ich suche.', toolCalls: [{ id: 'c1', name: 'search_catalog', arguments: { query: 'Dark Magician' } }] }),
    legacyRow({ id: 't1', role: 'tool', content: JSON.stringify({ items: [{ id: 46986414, name: 'Dark Magician' }], truncated: false }), toolCallId: 'c1', toolName: 'search_catalog' }),
    legacyRow({ id: 'a2', role: 'assistant', toolCalls: [
      { id: 'c2', name: 'add_to_inventory', arguments: { items: [{ catalogCardId: 46986414, quantity: 2 }] } },
      { id: 'c3', name: 'get_deck', arguments: { id: 'gone' } },
      { id: 'c4', name: 'list_formats', arguments: {} },
    ] }),
    legacyRow({ id: 't2', role: 'tool', content: JSON.stringify({ status: 'pending_confirmation', message: TOOL_TEXT.pending }), toolCallId: 'c2', toolName: 'add_to_inventory' }),
    legacyRow({ id: 't3', role: 'tool', content: JSON.stringify({ error: 'Deck not found' }), toolCallId: 'c3', toolName: 'get_deck' }),
    // c4's tool row is missing (the turn died in between).
    legacyRow({ id: 't-orphan', role: 'tool', content: '[]', toolCallId: 'nobody', toolName: 'list_formats' }),
    legacyRow({ id: 'a3', role: 'assistant', content: 'Vorschlag angelegt.' }),
    legacyRow({ id: 'u2', role: 'user', content: 'danke' }),
    legacyRow({ id: 'a4', role: 'assistant', content: 'Gern!' }),
  ]
  const now = new Date(clock)
  db.insert(schema.assistantAction).values({
    id: 'act-1',
    conversationId,
    messageId: 'a2',
    userId: 'user-a',
    kind: 'add_to_inventory',
    payload: { items: [{ catalogCardId: 46986414, quantity: 2, name: 'Dark Magician' }] },
    summary: 'Add 1 card(s) to the inventory: Dark Magician x2',
    status: 'pending',
    createdAt: now,
  }).run()
  return rows
}

describe('legacyRowsToUIMessages', () => {
  it('regroups a multi-round answer into one assistant message: step per round, chips, then that round\'s proposals', () => {
    const rows = seedLegacyConversation()
    const action = toActionView(db.select().from(schema.assistantAction).get()!)

    const messages = legacyRowsToUIMessages(rows, new Map([['a2', [action]]]))

    expect(messages.map(message => [message.id, message.role])).toEqual([
      ['u1', 'user'],
      ['a1', 'assistant'],
      ['u2', 'user'],
      ['a4', 'assistant'],
    ])
    expect(messages[0]!.parts).toEqual([
      { type: 'text', text: 'füge Dark Magician hinzu' },
      { type: 'data-image', data: { index: 1 } },
    ])
    expect(messages[1]!.parts).toEqual([
      { type: 'step-start' },
      { type: 'text', text: 'Ich suche.', state: 'done' },
      { type: 'tool-search_catalog', toolCallId: 'c1', state: 'output-available', input: { query: 'Dark Magician' }, output: { result: { items: [{ id: 46986414, name: 'Dark Magician' }], truncated: false } } },
      { type: 'step-start' },
      { type: 'tool-add_to_inventory', toolCallId: 'c2', state: 'output-available', input: { items: [{ catalogCardId: 46986414, quantity: 2 }] }, output: { result: { status: 'pending_confirmation', message: TOOL_TEXT.pending } } },
      { type: 'tool-get_deck', toolCallId: 'c3', state: 'output-error', input: { id: 'gone' }, errorText: 'Deck not found' },
      { type: 'tool-list_formats', toolCallId: 'c4', state: 'output-error', input: {}, errorText: TOOL_TEXT.missingResult },
      { type: 'data-action', id: 'act-1', data: action },
      { type: 'step-start' },
      { type: 'text', text: 'Vorschlag angelegt.', state: 'done' },
    ])
    expect(messages[3]!.parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'Gern!', state: 'done' }])
  })

  it('keeps new-format rows as stored, between legacy ones', () => {
    const rows = [
      legacyRow({ id: 'u1', role: 'user', content: 'alt' }),
      legacyRow({ id: 'a1', role: 'assistant', content: 'alte Antwort' }),
      legacyRow({ id: 'u2', role: 'user', content: 'neu', parts: [{ type: 'text', text: 'neu' }] }),
      legacyRow({ id: 'a2', role: 'assistant', content: 'neue Antwort', parts: [{ type: 'step-start' }, { type: 'text', text: 'neue Antwort', state: 'done' }] }),
    ]

    const messages = legacyRowsToUIMessages(rows, new Map())

    expect(messages.map(message => message.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(messages[3]).toMatchObject({ role: 'assistant', parts: [{ type: 'step-start' }, { type: 'text', text: 'neue Antwort' }], metadata: { createdAt: rows[3]!.createdAt.toISOString() } })
  })

  it('converts into a valid model history: every tool call followed by its result, data parts left out', async () => {
    const rows = seedLegacyConversation()
    const tools = buildAssistantToolSet({
      db, userId: 'user-a', cardLocale: 'de', conversationId, messageId: 'x',
      limits: { toolResultChars: 60_000, toolResultItems: 100 },
      actionView: toActionView, deckName: () => undefined, onAction: () => {},
    })

    const model = await convertToModelMessages<AssistantUIMessage>(legacyRowsToUIMessages(rows, new Map()), { tools, ignoreIncompleteToolCalls: true })

    expect(model.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'user', 'assistant'])
    const calls = model.flatMap(message => message.role === 'assistant' && Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-call').map(part => part.toolCallId) : [])
    const results = model.flatMap(message => message.role === 'tool' ? message.content.flatMap(part => part.type === 'tool-result' ? [part.toolCallId] : []) : [])
    expect(results).toEqual(calls)
    expect(model[4]).toMatchObject({ role: 'tool', content: [
      { toolCallId: 'c2', output: { type: 'json', value: { status: 'pending_confirmation' } } },
      { toolCallId: 'c3', output: { type: 'error-text', value: 'Deck not found' } },
      { toolCallId: 'c4', output: { type: 'error-text', value: TOOL_TEXT.missingResult } },
    ] })
    // The photo placeholder never reaches the model.
    expect(model[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'füge Dark Magician hinzu' }] })
  })
})

describe('loadUiMessages (display hydration)', () => {
  it('refreshes proposals to their current state and drops a data-action part whose action is gone', () => {
    seedLegacyConversation()
    legacyRow({ id: 'u3', role: 'user', content: 'x', parts: [{ type: 'text', text: 'x' }] })
    legacyRow({
      id: 'a5',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'data-action', id: 'act-1', data: { id: 'act-1', messageId: 'a2', kind: 'add_to_inventory', summary: 'stale', payload: {}, status: 'pending' } },
        { type: 'data-action', id: 'gone', data: { id: 'gone', messageId: 'a5', kind: 'add_to_inventory', summary: 'gone', payload: {}, status: 'pending' } },
      ],
    })
    db.update(schema.assistantAction).set({ status: 'rejected' }).run()

    const messages = loadUiMessages(db, 'user-a', conversationId)

    const legacyAction = messages[1]!.parts.find(part => part.type === 'data-action')
    expect(legacyAction).toMatchObject({ data: { id: 'act-1', status: 'rejected' } })
    expect(messages.at(-1)!.parts).toEqual([
      { type: 'step-start' },
      { type: 'data-action', id: 'act-1', data: expect.objectContaining({ status: 'rejected', summary: 'Add 1 card(s) to the inventory: Dark Magician x2' }) },
    ])
  })

  it('names the caller\'s decks in tool parts by their current name, never a foreign or deleted one (#53)', () => {
    const own = createDeck(db, 'user-a', { name: 'Magier', description: null })
    const foreign = createDeck(db, 'user-b', { name: 'Fremd', description: null })
    legacyRow({ id: 'u1', role: 'user', content: 'prüfe' })
    legacyRow({ id: 'a1', role: 'assistant', toolCalls: [
      { id: 'c1', name: 'get_deck', arguments: { id: own.id } },
      { id: 'c2', name: 'validate_deck', arguments: { deckId: foreign.id } },
    ] })
    legacyRow({ id: 't1', role: 'tool', content: '{}', toolCallId: 'c1', toolName: 'get_deck' })
    legacyRow({ id: 't2', role: 'tool', content: '{}', toolCallId: 'c2', toolName: 'validate_deck' })
    legacyRow({ id: 'u2', role: 'user', content: 'neu', parts: [{ type: 'text', text: 'neu' }] })
    legacyRow({ id: 'a2', role: 'assistant', parts: [
      { type: 'tool-get_deck', toolCallId: 'c3', state: 'output-available', input: { id: own.id }, output: { result: {}, deckName: 'Alter Name' } },
    ] })
    updateDeck(db, 'user-a', own.id, { name: 'Umbenannt' })

    const messages = loadUiMessages(db, 'user-a', conversationId)

    const toolOutputs = messages.flatMap(message => message.parts.flatMap(part => 'output' in part ? [part.output] : []))
    expect(toolOutputs).toEqual([
      { result: {}, deckName: 'Umbenannt' },
      { result: {} },
      { result: {}, deckName: 'Umbenannt' },
    ])
  })

  it('resolves deck and collection names of proposals (#69), null for gone or foreign ones', () => {
    const deck = createDeck(db, 'user-a', { name: 'Magier', description: null })
    db.insert(schema.collection).values([
      { id: 'col-own', userId: 'user-a', name: 'Ordner', createdAt: new Date(), updatedAt: new Date() },
      { id: 'col-foreign', userId: 'user-b', name: 'Fremd', createdAt: new Date(), updatedAt: new Date() },
    ]).run()
    legacyRow({ id: 'u1', role: 'user', content: 'x' })
    legacyRow({ id: 'a1', role: 'assistant', content: 'y' })
    const base = { conversationId, messageId: 'a1', userId: 'user-a', summary: 's', status: 'pending' as const, createdAt: new Date() }
    db.insert(schema.assistantAction).values([
      { ...base, id: 'old-deck-action', kind: 'update_deck_cards', payload: { deckId: deck.id, changes: [] } },
      { ...base, id: 'named-deck-action', kind: 'update_deck_cards', payload: { deckId: deck.id, deckName: 'Magier', changes: [] } },
      { ...base, id: 'gone-deck-action', kind: 'set_deck_format', payload: { deckId: 'gone', formatId: null } },
      { ...base, id: 'inventory-action', kind: 'add_to_inventory', payload: { items: [{ catalogCardId: 1, quantity: 1, collectionId: 'col-own' }, { catalogCardId: 2, quantity: 1, collectionId: 'col-foreign' }, { catalogCardId: 3, quantity: 1 }] } },
    ]).run()

    const views = new Map(loadUiMessages(db, 'user-a', conversationId)[1]!.parts
      .flatMap(part => part.type === 'data-action' ? [[part.data.id, part.data] as const] : []))

    expect(views.get('old-deck-action')!.display).toEqual({ deckName: 'Magier' })
    expect(views.get('named-deck-action')!.display).toBeUndefined()
    expect(views.get('gone-deck-action')!.display).toEqual({ deckName: null })
    expect(views.get('inventory-action')!.display).toEqual({ collectionNames: { 'col-own': 'Ordner', 'col-foreign': null } })
  })
})

describe('loadUiMessages (running turn)', () => {
  it('leaves out the still-empty answer of a turn in progress', () => {
    legacyRow({ id: 'u1', role: 'user', content: 'x', parts: [{ type: 'text', text: 'x' }] })
    legacyRow({ id: 'a1', role: 'assistant', parts: [] })
    expect(loadUiMessages(db, 'user-a', conversationId).map(message => message.id)).toEqual(['u1'])
  })
})

describe('trimUiHistory', () => {
  const message = (id: string, role: 'user' | 'assistant', text: string): AssistantUIMessage => ({ id, role, parts: [{ type: 'text', text }] })

  it('keeps the last messages within count and size, starting at a user message; the newest always stays', () => {
    const messages = [message('1', 'user', 'a'), message('2', 'assistant', 'b'), message('3', 'user', 'c'), message('4', 'assistant', 'd'), message('5', 'user', 'e')]
    expect(trimUiHistory(messages, { historyMessages: 4, historyChars: 10_000 }).map(m => m.id)).toEqual(['3', '4', '5'])
    expect(trimUiHistory(messages, { historyMessages: 100, historyChars: 1 }).map(m => m.id)).toEqual(['5'])
  })

  it('doesn\'t count data parts and reasoning the model never reads', () => {
    const big: AssistantUIMessage = { id: '2', role: 'assistant', parts: [
      { type: 'reasoning', text: 'x'.repeat(5000) },
      { type: 'data-action', id: 'a', data: { id: 'a', messageId: '2', kind: 'create_deck', summary: 's', payload: { blob: 'y'.repeat(5000) }, status: 'pending' } },
      { type: 'text', text: 'ok' },
    ] }
    const messages = [message('1', 'user', 'a'), big, message('3', 'user', 'c')]
    expect(trimUiHistory(messages, { historyMessages: 100, historyChars: 500 }).map(m => m.id)).toEqual(['1', '2', '3'])
  })
})

describe('validateAssistantTurnRequest', () => {
  const submit = (parts: unknown[], extra: Record<string, unknown> = {}) => ({ trigger: 'submit-message', message: { role: 'user', parts, ...extra } })

  it('accepts a user message of text and image file parts, trimmed', () => {
    const id = '0b6c3a3e-8a0c-4f0e-9d8f-2a1b3c4d5e6f'
    expect(validateAssistantTurnRequest(submit([{ type: 'text', text: '  Hallo  ' }, { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,abc' }], { id })))
      .toEqual({ trigger: 'submit-message', clientMessageId: id, text: 'Hallo', images: [{ mediaType: 'image/png', url: 'data:image/png;base64,abc' }] })
  })

  it('ignores a client id that isn\'t a UUID, and defaults the trigger to submit', () => {
    expect(validateAssistantTurnRequest({ message: { id: 'abc', role: 'user', parts: [{ type: 'text', text: 'x' }] } }))
      .toEqual({ trigger: 'submit-message', text: 'x', images: [] })
  })

  it('accepts a regenerate request without a message', () => {
    expect(validateAssistantTurnRequest({ trigger: 'regenerate-message', messageId: 'x' })).toEqual({ trigger: 'regenerate-message', text: '', images: [] })
  })

  it.each([
    ['a non-object body', 'nope'],
    ['an unknown trigger', { trigger: 'resume' }],
    ['a missing message', { trigger: 'submit-message' }],
    ['an assistant message', { trigger: 'submit-message', message: { role: 'assistant', parts: [{ type: 'text', text: 'x' }] } }],
    ['an empty message', submit([])],
    ['a whitespace-only message', submit([{ type: 'text', text: '   ' }])],
    ['other part types', submit([{ type: 'text', text: 'x' }, { type: 'reasoning', text: 'y' }])],
    ['a non-data-URL image', submit([{ type: 'file', mediaType: 'image/png', url: 'https://example.com/x.png' }])],
    ['a disallowed MIME type', submit([{ type: 'file', mediaType: 'application/pdf', url: 'data:application/pdf;base64,abc' }])],
    ['text over the limit', submit([{ type: 'text', text: 'x'.repeat(20_001) }])],
    ['more than 6 images', submit(Array.from({ length: 7 }, () => ({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,abc' })))],
    ['images over 12 MB decoded', submit([{ type: 'file', mediaType: 'image/png', url: `data:image/png;base64,${'A'.repeat(17 * 1024 * 1024)}` }])],
  ])('rejects %s (400)', (_label, body) => {
    expect(() => validateAssistantTurnRequest(body)).toThrowError(expect.objectContaining({ statusCode: 400 }))
  })
})
