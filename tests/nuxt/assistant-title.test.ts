// Model-generated conversation titles (server/utils/assistant-title.ts,
// #129): when the title model may name a conversation (only an automatic
// title, the first few messages, a model configured), what it reads, how its
// answer is cleaned, and that a failure or a concurrent change keeps the
// title as it is.

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../server/db/schema'
import { conversationTitleFromText, createConversation } from '../../server/utils/assistant-chat'
import { createFakeTitleModel } from '../../server/utils/assistant-model'
import type { AssistantTitleModel } from '../../server/utils/assistant-model'
import { TITLE_LANGUAGE_INSTRUCTION } from '../../server/utils/assistant-prompts'
import { automaticTitles, cleanGeneratedTitle, generateConversationTitle } from '../../server/utils/assistant-title'
import { insertAssistantPlaceholder, persistUserMessage, updateAssistantMessage } from '../../server/utils/assistant-ui-messages'
import { createDeck } from '../../server/utils/decks'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>
type GenerateOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  const now = new Date()
  db.insert(schema.user).values([
    { id: 'user-a', name: 'User A', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'User B', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A title model answering `text` (or throwing it), counting its calls and keeping what it was asked. */
function mockTitleModel(answer: string | Error | ((options: GenerateOptions) => string)) {
  const calls: GenerateOptions[] = []
  const model = new MockLanguageModelV4({
    provider: 'test',
    modelId: 'title-test',
    doGenerate: async (options) => {
      calls.push(options)
      if (answer instanceof Error) {
        throw answer
      }
      const text = typeof answer === 'function' ? answer(options) : answer
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
        warnings: [],
      }
    },
  })
  return { titleModel: { id: 'title-test', model } satisfies AssistantTitleModel, calls }
}

const fakeTitleModel: AssistantTitleModel = { id: 'glm-5.3-flash', model: createFakeTitleModel() }

let clock = Date.parse('2026-01-01T10:00:00Z')

function nextDate(): Date {
  clock += 1000
  return new Date(clock)
}

/** One turn as assistant-turn.ts stores it: the user message (the first one names the conversation) and the answer. */
function addTurn(conversationId: string, text: string, answer = 'Ich habe 1 Karte gefunden: Dark Magician', imageCount = 0) {
  const isFirst = db.select().from(schema.assistantMessage).where(eq(schema.assistantMessage.conversationId, conversationId)).all().length === 0
  const userRow = persistUserMessage(db, { conversationId, id: crypto.randomUUID(), text, imageCount, now: nextDate() })
  if (isFirst && text !== '') {
    db.update(schema.assistantConversation).set({ title: conversationTitleFromText(text) }).where(eq(schema.assistantConversation.id, conversationId)).run()
  }
  const answerRow = insertAssistantPlaceholder(db, { conversationId, id: crypto.randomUUID(), after: userRow.createdAt })
  updateAssistantMessage(db, answerRow.id, [{ type: 'text', text: answer, state: 'done' }])
}

function storedConversation(id: string) {
  return db.select().from(schema.assistantConversation).where(eq(schema.assistantConversation.id, id)).get()!
}

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode
}

describe('generateConversationTitle', () => {
  it('replaces the first-message title with the cleaned model title, leaving updatedAt alone', async () => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician')
    const before = storedConversation(conversation.id)
    expect(before.title).toBe('suche Dark Magician')

    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel: fakeTitleModel })
    expect(result.generated).toBe(true)
    expect(result.conversation.title).toBe('Thema: suche Dark Magician')
    const after = storedConversation(conversation.id)
    expect(after.title).toBe('Thema: suche Dark Magician')
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  it('is idempotent: once named, no further model call happens', async () => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician')
    const { titleModel, calls } = mockTitleModel('Dark Magician gesucht')
    expect((await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel })).generated).toBe(true)
    addTurn(conversation.id, 'und Blue-Eyes?')

    const again = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel })
    expect(again).toMatchObject({ generated: false, conversation: { title: 'Dark Magician gesucht' } })
    expect(calls).toHaveLength(1)
  })

  it('names a conversation whose first message was a photo (the default title) from the answer', async () => {
    const conversation = createConversation(db, 'user-a', 'en')
    addTurn(conversation.id, '', 'Auf dem Bild sehe ich: Dark Magician.', 1)
    expect(storedConversation(conversation.id).title).toBe('New conversation')

    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel: fakeTitleModel })
    expect(result).toMatchObject({ generated: true, conversation: { title: 'Thema: Auf dem Bild sehe' } })
  })

  it('keeps a legacy "Deck: <name>" title (ADR 0021: a user title, not an automatic one)', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Magier-Deck', description: null })
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'Was fehlt meinem Deck?')
    // A conversation linked before ADR 0021 kept its deck title after the first message.
    db.update(schema.assistantConversation)
      .set({ deckId: deck.id, title: 'Deck: Magier-Deck' })
      .where(eq(schema.assistantConversation.id, conversation.id))
      .run()
    const { titleModel, calls } = mockTitleModel('Sollte nicht kommen')

    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel })
    expect(result).toMatchObject({ generated: false, conversation: { title: 'Deck: Magier-Deck' } })
    expect(result.conversation).not.toHaveProperty('deck')
    expect(calls).toHaveLength(0)
  })

  it('keeps a title that isn\'t automatic (as a renamed one would be)', async () => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician')
    db.update(schema.assistantConversation).set({ title: 'Meine Magier' }).where(eq(schema.assistantConversation.id, conversation.id)).run()
    const { titleModel, calls } = mockTitleModel('Dark Magician gesucht')

    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel })
    expect(result).toMatchObject({ generated: false, conversation: { title: 'Meine Magier' } })
    expect(calls).toHaveLength(0)
  })

  it('stops trying after three user messages, and with no message at all', async () => {
    const conversation = createConversation(db, 'user-a')
    const { titleModel, calls } = mockTitleModel('Dark Magician gesucht')
    expect((await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel })).generated).toBe(false)

    for (const text of ['suche Dark Magician', 'und Blue-Eyes?', 'und Kuriboh?', 'danke']) {
      addTurn(conversation.id, text)
    }
    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel })
    expect(result).toMatchObject({ generated: false, conversation: { title: 'suche Dark Magician' } })
    expect(calls).toHaveLength(0)
  })

  it('keeps the title when the model fails, and doesn\'t throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'titel-fehler bitte')

    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel: fakeTitleModel })
    expect(result).toMatchObject({ generated: false, conversation: { title: 'titel-fehler bitte' } })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[assistant] title generation failed'), expect.anything())
  })

  it.each(['', '   \n  ', '""'])('keeps the title when the model answers %j', async (answer) => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician')
    const { titleModel } = mockTitleModel(answer)
    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel })
    expect(result).toMatchObject({ generated: false, conversation: { title: 'suche Dark Magician' } })
  })

  it('does nothing when titles are off (no title model)', async () => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician')
    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel: null })
    expect(result).toMatchObject({ generated: false, conversation: { title: 'suche Dark Magician' } })
  })

  it('never overwrites a title that changed while the model was writing', async () => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician')
    const { titleModel } = mockTitleModel(() => {
      db.update(schema.assistantConversation).set({ title: 'Umbenannt' }).where(eq(schema.assistantConversation.id, conversation.id)).run()
      return 'Dark Magician gesucht'
    })

    const result = await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'de', titleModel })
    expect(result).toMatchObject({ generated: false, conversation: { title: 'Umbenannt' } })
    expect(storedConversation(conversation.id).title).toBe('Umbenannt')
  })

  it('skips a second request while one is running for the conversation', async () => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician')
    const { titleModel, calls } = mockTitleModel('Dark Magician gesucht')
    const options = { db, userId: 'user-a', conversationId: conversation.id, locale: 'de' as const, titleModel }
    const [first, second] = await Promise.all([generateConversationTitle(options), generateConversationTitle(options)])
    expect([first.generated, second.generated]).toEqual([true, false])
    expect(calls).toHaveLength(1)
  })

  it('asks for the title in the interface language, with the first message and answer as data', async () => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician', 'Ich habe 1 Karte gefunden.')
    const { titleModel, calls } = mockTitleModel('Dark Magician search')
    await generateConversationTitle({ db, userId: 'user-a', conversationId: conversation.id, locale: 'en', titleModel })

    const [call] = calls
    const system = call!.prompt.find(message => message.role === 'system')!.content as string
    expect(system.endsWith(TITLE_LANGUAGE_INSTRUCTION.en)).toBe(true)
    expect(system).not.toContain(TITLE_LANGUAGE_INSTRUCTION.de)
    expect(JSON.stringify(call!.prompt)).toContain('User message:\\n<<<\\nsuche Dark Magician\\n>>>')
    expect(JSON.stringify(call!.prompt)).toContain('Assistant answer:\\n<<<\\nIch habe 1 Karte gefunden.\\n>>>')
    expect(call!.headers?.['x-opencode-session']).toBe(conversation.id)
  })

  it('answers 404 for another user\'s conversation', async () => {
    const conversation = createConversation(db, 'user-a')
    addTurn(conversation.id, 'suche Dark Magician')
    const error = await generateConversationTitle({ db, userId: 'user-b', conversationId: conversation.id, locale: 'de', titleModel: fakeTitleModel }).catch(caught => caught)
    expect(statusOf(error)).toBe(404)
    expect(storedConversation(conversation.id).title).toBe('suche Dark Magician')
  })
})

describe('automaticTitles', () => {
  it('lists the first message and both default titles', () => {
    expect(automaticTitles('suche Dark Magician')).toEqual(['suche Dark Magician', 'Neue Unterhaltung', 'New conversation'])
    expect(automaticTitles('')).toEqual(['Neue Unterhaltung', 'New conversation'])
    expect(automaticTitles('x'.repeat(100))[0]).toHaveLength(80)
  })
})

describe('cleanGeneratedTitle', () => {
  it.each([
    ['„Dunkler Magier im Deck“', 'Dunkler Magier im Deck'],
    ['"Dark Magician search"', 'Dark Magician search'],
    ['Titel: Deck-Hilfe.', 'Deck-Hilfe'],
    ['Title: **Blue-Eyes Deck**', 'Blue-Eyes Deck'],
    ['# Kartensuche', 'Kartensuche'],
    ['\n\nKartensuche Dark Magician\nDas ist ein passender Titel.', 'Kartensuche Dark Magician'],
    ['<think>Der Nutzer sucht eine Karte.\nAlso …</think>\nKartensuche', 'Kartensuche'],
    ['eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf', 'eins zwei drei vier fünf sechs sieben acht'],
    ['Dark   Magician\tsuche', 'Dark Magician suche'],
    ['Dark Magician\'s Deck', 'Dark Magician\'s Deck'],
  ])('%j → %j', (raw, expected) => {
    expect(cleanGeneratedTitle(raw)).toBe(expected)
  })

  it.each(['', '   ', '<think>nur Gedanken</think>', '„“', '...'])('%j → null', (raw) => {
    expect(cleanGeneratedTitle(raw)).toBeNull()
  })

  it('caps the title at 80 characters', () => {
    expect(cleanGeneratedTitle(`${'a'.repeat(50)} ${'b'.repeat(50)}`)).toHaveLength(80)
  })
})
