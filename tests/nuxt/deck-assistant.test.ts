import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../server/db/schema'
import { createDeck, updateDeck, upsertDeckCard } from '../../server/utils/decks'
import { createRuleFormat, validateRuleFormatInput } from '../../server/utils/rule-formats'
import { addOwnedCard, validateInventoryInput } from '../../server/utils/inventory'
import {
  ASSISTANT_POOL_MAX,
  runDeckAssistant,
  validateDeckAssistantRequest,
} from '../../server/utils/deck-assistant'
import {
  createFakeModel,
  createOpenAiCompatibleModel,
  getDeckAssistantStatus,
  useDeckAssistantModel,
} from '../../server/utils/deck-assistant-model'
import type { AssistantModelInput, DeckAssistantModel } from '../../server/utils/deck-assistant-model'
import type { DeckAssistantRequest } from '../../shared/deck-assistant'

const CARD = {
  darkMagician: 46986414,
  potOfGreed: 55144522,
  mirrorForce: 44095762,
  stardustDragon: 44508094,
  raigeki: 12580477,
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
    {
      id: CARD.darkMagician,
      name: 'Dark Magician',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'The ultimate wizard.',
      race: 'Spellcaster',
      attribute: 'DARK',
      atk: 2500,
      def: 2100,
      level: 7,
      syncedAt: now,
    },
    {
      id: CARD.potOfGreed,
      name: 'Pot of Greed',
      type: 'Spell Card',
      frameType: 'spell',
      desc: 'Draw two cards.',
      race: 'Normal',
      syncedAt: now,
    },
    {
      id: CARD.mirrorForce,
      name: 'Mirror Force',
      type: 'Trap Card',
      frameType: 'trap',
      desc: 'Destroy all attacking monsters your opponent controls.',
      race: 'Normal',
      syncedAt: now,
    },
    {
      id: CARD.stardustDragon,
      name: 'Stardust Dragon',
      type: 'Synchro Monster',
      frameType: 'synchro',
      desc: 'Tuner + 1 or more non-Tuner monsters.',
      race: 'Dragon',
      attribute: 'WIND',
      atk: 2500,
      def: 2000,
      level: 8,
      syncedAt: now,
    },
    {
      id: CARD.raigeki,
      name: 'Raigeki',
      type: 'Spell Card',
      frameType: 'spell',
      desc: 'Destroy all monsters your opponent controls.',
      race: 'Normal',
      syncedAt: now,
    },
  ]).run()
}

function own(db: TestDb, userId: string, catalogCardId: number, quantity: number) {
  return addOwnedCard(db, userId, validateInventoryInput({ catalog_card_id: catalogCardId, quantity }))
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

function modelReturning(output: unknown): DeckAssistantModel {
  return { id: 'test-model', async generate() { return output } }
}

function capturingModel(output: unknown) {
  const calls: AssistantModelInput[] = []
  const model: DeckAssistantModel = {
    id: 'test-model',
    async generate(input) {
      calls.push(input)
      return output
    },
  }
  return { model, calls }
}

// A card_status ban plus a filter cap, used across most pool/build/improve tests.
const FORBID_AND_CAP_RULES = {
  rules: [
    { kind: 'card_status' as const, status: 'forbidden' as const, cardIds: [CARD.potOfGreed] },
    { kind: 'filter' as const, match: 'matching' as const, filter: { types: ['Trap Card'] }, maxCopies: 1 as const, label: 'Fallen limitiert' },
  ],
}

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  seedUsersAndCatalog(db)
})

describe('validateDeckAssistantRequest', () => {
  it('accepts a well-formed build and improve request', () => {
    expect(validateDeckAssistantRequest({ mode: 'build', playStyle: 'aggro' })).toEqual({
      mode: 'build',
      playStyle: 'aggro',
    })

    expect(validateDeckAssistantRequest({
      mode: 'improve',
      deckId: 'deck-1',
      playStyle: 'control',
      notes: '  mehr Fallenkarten bitte  ',
      includeMissing: false,
      formatId: null,
    })).toEqual({
      mode: 'improve',
      deckId: 'deck-1',
      playStyle: 'control',
      notes: 'mehr Fallenkarten bitte',
      includeMissing: false,
      formatId: null,
    })

    // An empty formatId behaves like null, matching the deck update convention.
    expect(validateDeckAssistantRequest({ mode: 'build', playStyle: 'combo', formatId: '' }).formatId).toBeNull()
  })

  it('rejects an unknown mode', async () => {
    expect(await statusOf(async () => validateDeckAssistantRequest({ mode: 'nope', playStyle: 'balanced' }))).toBe(400)
  })

  it('requires deckId for mode "improve"', async () => {
    expect(await statusOf(async () => validateDeckAssistantRequest({ mode: 'improve', playStyle: 'balanced' }))).toBe(400)
  })

  it('rejects an invalid playStyle', async () => {
    expect(await statusOf(async () => validateDeckAssistantRequest({ mode: 'build', playStyle: 'op' }))).toBe(400)
    expect(await statusOf(async () => validateDeckAssistantRequest({ mode: 'build' }))).toBe(400)
  })

  it('rejects notes over the length limit', async () => {
    const notes = 'x'.repeat(501)
    expect(await statusOf(async () => validateDeckAssistantRequest({ mode: 'build', playStyle: 'balanced', notes }))).toBe(400)
  })

  it('rejects a non-boolean includeMissing', async () => {
    expect(await statusOf(async () => validateDeckAssistantRequest({ mode: 'build', playStyle: 'balanced', includeMissing: 'yes' }))).toBe(400)
  })

  it('rejects a non-string formatId', async () => {
    expect(await statusOf(async () => validateDeckAssistantRequest({ mode: 'build', playStyle: 'balanced', formatId: 42 }))).toBe(400)
  })
})

describe('candidate pool', () => {
  it('excludes format-forbidden cards and reports the per-card cap', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))

    await own(db, 'user-a', CARD.darkMagician, 3)
    await own(db, 'user-a', CARD.potOfGreed, 2)
    await own(db, 'user-a', CARD.mirrorForce, 5)
    await own(db, 'user-a', CARD.stardustDragon, 2)

    const capture = capturingModel({ summary: 'x', cards: [], missing: [] })
    const request: DeckAssistantRequest = { mode: 'build', playStyle: 'balanced', formatId: format.id }
    await runDeckAssistant(db, 'user-a', request, capture.model)

    const pool = capture.calls[0]!.pool
    const byName = Object.fromEntries(pool.map(card => [card.name, card]))

    expect(byName['Pot of Greed']).toBeUndefined()
    expect(byName['Dark Magician']).toMatchObject({ owned: 3, maxCopies: 3, extraDeck: false })
    expect(byName['Mirror Force']).toMatchObject({ owned: 5, maxCopies: 1, extraDeck: false })
    expect(byName['Stardust Dragon']).toMatchObject({ owned: 2, maxCopies: 3, extraDeck: true })
  })

  it('falls back to a cap of 3 without a format', async () => {
    await own(db, 'user-a', CARD.potOfGreed, 1)

    const capture = capturingModel({ summary: 'x', cards: [], missing: [] })
    await runDeckAssistant(db, 'user-a', { mode: 'build', playStyle: 'balanced' }, capture.model)

    expect(capture.calls[0]!.pool[0]).toMatchObject({ name: 'Pot of Greed', maxCopies: 3 })
  })
})

describe('build mode post-processing', () => {
  it('drops unknown ids, fixes sections, clamps to owned/format cap, and merges duplicates', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))

    await own(db, 'user-a', CARD.darkMagician, 3)
    await own(db, 'user-a', CARD.mirrorForce, 5)
    await own(db, 'user-a', CARD.stardustDragon, 2)

    const model = modelReturning({
      summary: 'Ein solides Deck.',
      cards: [
        { id: CARD.darkMagician, section: 'main', quantity: 2, reason: 'Kernkarte' },
        { id: CARD.darkMagician, section: 'main', quantity: 5, reason: 'Duplikat' },
        { id: CARD.mirrorForce, section: 'main', quantity: 5, reason: 'Falle' },
        { id: CARD.stardustDragon, section: 'main', quantity: 1, reason: 'falsche Sektion' },
        { id: 999999999, section: 'main', quantity: 1, reason: 'unbekannt' },
      ],
      missing: [],
    })

    const result = await runDeckAssistant(db, 'user-a', {
      mode: 'build',
      playStyle: 'balanced',
      formatId: format.id,
      includeMissing: false,
    }, model)

    expect(result.deck!.main).toEqual(expect.arrayContaining([
      expect.objectContaining({ catalogCardId: CARD.darkMagician, quantity: 3 }),
      expect.objectContaining({ catalogCardId: CARD.mirrorForce, quantity: 1 }),
    ]))
    expect(result.deck!.main).toHaveLength(2)
    // Extra-deck card placed in "main" by the model is corrected.
    expect(result.deck!.extra).toEqual([expect.objectContaining({ catalogCardId: CARD.stardustDragon, quantity: 1 })])

    expect(result.warnings.some(warning => warning.includes('1'))).toBe(true)
    expect(result.model).toBe('test-model')
    expect(result.changes).toEqual([])
  })

  it('routes a non-extra card placed in "extra" back to "main"', async () => {
    await own(db, 'user-a', CARD.darkMagician, 1)

    const model = modelReturning({
      summary: 'x',
      cards: [{ id: CARD.darkMagician, section: 'extra', quantity: 1, reason: 'falsch' }],
      missing: [],
    })

    const result = await runDeckAssistant(db, 'user-a', { mode: 'build', playStyle: 'balanced', includeMissing: false }, model)

    expect(result.deck!.extra).toEqual([])
    expect(result.deck!.main).toEqual([expect.objectContaining({ catalogCardId: CARD.darkMagician })])
  })
})

describe('improve mode post-processing', () => {
  function deckWithFormat() {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))
    const deck = createDeck(db, 'user-a', { name: 'Mein Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.mirrorForce, section: 'main', quantity: 1 })
    updateDeck(db, 'user-a', deck.id, { formatId: format.id })
    return { deck, format }
  }

  it('clamps an add, drops a no-op add, drops a remove of a card not in the deck, and reflects everything in validation', async () => {
    const { deck } = deckWithFormat()

    await own(db, 'user-a', CARD.darkMagician, 3)
    await own(db, 'user-a', CARD.mirrorForce, 5)
    await own(db, 'user-a', CARD.stardustDragon, 2)

    const model = modelReturning({
      summary: 'Verbesserungen.',
      changes: [
        { action: 'add', id: CARD.darkMagician, section: 'main', quantity: 5, reason: 'mehr Magier' },
        { action: 'add', id: CARD.mirrorForce, section: 'main', quantity: 5, reason: 'schon am Limit' },
        { action: 'remove', id: CARD.potOfGreed, section: 'main', quantity: 1, reason: 'nicht im Deck' },
        { action: 'remove', id: CARD.mirrorForce, section: 'main', quantity: 1, reason: 'raus damit' },
        { action: 'add', id: CARD.stardustDragon, section: 'main', quantity: 5, reason: 'Extra Deck verstärken' },
        { action: 'add', id: 999999999, section: 'main', quantity: 1, reason: 'unbekannt' },
      ],
      missing: [],
    })

    const result = await runDeckAssistant(db, 'user-a', {
      mode: 'improve',
      deckId: deck.id,
      playStyle: 'balanced',
      includeMissing: false,
    }, model)

    expect(result.changes).toEqual([
      expect.objectContaining({ action: 'add', catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 }),
      expect.objectContaining({ action: 'remove', catalogCardId: CARD.mirrorForce, section: 'main', quantity: 1 }),
      expect.objectContaining({ action: 'add', catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 2 }),
    ])
    expect(result.warnings.some(warning => warning.includes('1'))).toBe(true)

    expect(result.validation).not.toBeNull()
    expect(result.validation!.legal).toBe(true)
    expect(result.validation!.cards[CARD.darkMagician]?.status).toBe('unrestricted')
    expect(result.validation!.cards[CARD.mirrorForce]).toBeUndefined()
    expect(result.deck).toBeNull()
  })
})

describe('missing-card resolution', () => {
  it('resolves case-insensitively, drops unresolved/format-forbidden entries, and skips already-covered cards', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))
    await own(db, 'user-a', CARD.darkMagician, 3)

    const model = modelReturning({
      summary: 'x',
      cards: [],
      missing: [
        { name: 'DARK MAGICIAN', section: 'main', quantity: 2, reason: 'schon genug' },
        { name: 'raigeki', section: 'main', quantity: 2, reason: 'starke Entfernung' },
        { name: 'Totally Fake Card Name', section: 'main', quantity: 1, reason: 'gibt es nicht' },
        { name: 'Pot of Greed', section: 'main', quantity: 1, reason: 'verboten' },
      ],
    })

    const result = await runDeckAssistant(db, 'user-a', { mode: 'build', playStyle: 'balanced', formatId: format.id }, model)

    expect(result.missing).toEqual([
      expect.objectContaining({ catalogCardId: CARD.raigeki, name: 'Raigeki', quantity: 2, owned: 0 }),
    ])
    expect(result.warnings.some(warning => warning.includes('nicht im Katalog'))).toBe(true)
  })

  it('is skipped entirely when includeMissing is false', async () => {
    const model = modelReturning({
      summary: 'x',
      cards: [],
      missing: [{ name: 'Raigeki', section: 'main', quantity: 1, reason: 'x' }],
    })

    const result = await runDeckAssistant(db, 'user-a', { mode: 'build', playStyle: 'balanced', includeMissing: false }, model)
    expect(result.missing).toEqual([])
  })
})

describe('malformed model output', () => {
  it('rejects with a 502 when the shape does not match the schema', async () => {
    const model = modelReturning({ nonsense: true })
    expect(await statusOf(async () => runDeckAssistant(db, 'user-a', { mode: 'build', playStyle: 'balanced' }, model))).toBe(502)

    const stringModel = modelReturning('just a string')
    expect(await statusOf(async () => runDeckAssistant(db, 'user-a', { mode: 'build', playStyle: 'balanced' }, stringModel))).toBe(502)
  })
})

describe('format-less requests', () => {
  it('returns null validation when no format is in play', async () => {
    await own(db, 'user-a', CARD.darkMagician, 2)
    const model = modelReturning({
      summary: 'x',
      cards: [{ id: CARD.darkMagician, section: 'main', quantity: 2, reason: 'x' }],
      missing: [],
    })

    const result = await runDeckAssistant(db, 'user-a', { mode: 'build', playStyle: 'balanced', includeMissing: false }, model)
    expect(result.formatId).toBeNull()
    expect(result.validation).toBeNull()
  })
})

describe('deck ownership', () => {
  it('hides another user\'s deck behind a 404', async () => {
    const foreignDeck = createDeck(db, 'user-b', { name: 'Fremd', description: null })
    const model = modelReturning({ summary: 'x', changes: [], missing: [] })

    const request: DeckAssistantRequest = { mode: 'improve', deckId: foreignDeck.id, playStyle: 'balanced' }
    expect(await statusOf(async () => runDeckAssistant(db, 'user-a', request, model))).toBe(404)
  })
})

describe('fake model', () => {
  it('produces a structurally valid build result end-to-end', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Verbot', rules: FORBID_AND_CAP_RULES }))
    await own(db, 'user-a', CARD.darkMagician, 3)
    await own(db, 'user-a', CARD.mirrorForce, 2)
    await own(db, 'user-a', CARD.stardustDragon, 1)

    const result = await runDeckAssistant(db, 'user-a', {
      mode: 'build',
      playStyle: 'aggro',
      formatId: format.id,
    }, createFakeModel())

    expect(result.model).toBe('fake')
    expect(result.mode).toBe('build')
    expect(result.deck).not.toBeNull()
    expect(result.validation).not.toBeNull()
    for (const section of ['main', 'extra', 'side'] as const) {
      for (const entry of result.deck![section]) {
        expect(entry.quantity).toBeGreaterThan(0)
        expect(entry.quantity).toBeLessThanOrEqual(entry.owned)
      }
    }
  })

  it('produces a structurally valid improve result end-to-end', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 })
    await own(db, 'user-a', CARD.darkMagician, 3)
    await own(db, 'user-a', CARD.mirrorForce, 2)

    const result = await runDeckAssistant(db, 'user-a', {
      mode: 'improve',
      deckId: deck.id,
      playStyle: 'control',
    }, createFakeModel())

    expect(result.model).toBe('fake')
    expect(result.mode).toBe('improve')
    expect(result.deck).toBeNull()
    expect(Array.isArray(result.changes)).toBe(true)
  })
})

describe('pool truncation', () => {
  it('exports the documented pool cap', () => {
    expect(ASSISTANT_POOL_MAX).toBe(400)
  })
})

describe('assistant status/config resolution', () => {
  it('resolves to fake, openai-by-key, openai-by-custom-base-url, or disabled', () => {
    const config = useRuntimeConfig().assistant as { provider: string, baseUrl: string, apiKey: string, model: string }
    const original = { ...config }

    try {
      config.provider = 'fake'
      expect(getDeckAssistantStatus()).toEqual({ enabled: true, provider: 'fake', model: 'fake', baseUrl: null })
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
      })
      expect(useDeckAssistantModel()?.id).toBe('gpt-4o-mini')

      // No key, but a base URL explicitly pointed away from the default
      // (e.g. a keyless local Ollama server) still resolves to 'openai'.
      config.apiKey = ''
      config.baseUrl = 'http://localhost:11434/v1'
      expect(getDeckAssistantStatus()).toEqual({
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'localhost:11434',
      })

      config.baseUrl = ''
      expect(getDeckAssistantStatus()).toEqual({ enabled: false, provider: null, model: null, baseUrl: null })
      expect(useDeckAssistantModel()).toBeNull()
    }
    finally {
      Object.assign(config, original)
    }
  })
})

describe('OpenAI-compatible model', () => {
  const baseInput: AssistantModelInput = {
    mode: 'build',
    system: 'system prompt',
    context: 'stable context',
    prompt: 'user prompt',
    schema: { type: 'object' },
    pool: [],
    currentDeck: null,
    includeMissing: true,
  }

  interface RecordedInit { headers: Record<string, string>, body: string }
  interface RecordedCall { url: string, init: RecordedInit }

  function jsonResponse(status: number, body: unknown) {
    return { status, json: async () => body } as Response
  }

  function fetchReturning(...responses: Array<{ status: number, body: unknown }>): { fetch: typeof fetch, calls: RecordedCall[] } {
    const calls: RecordedCall[] = []
    let i = 0
    const fetchImpl = (async (url: string, init: RecordedInit) => {
      calls.push({ url, init })
      const response = responses[Math.min(i, responses.length - 1)]!
      i++
      return jsonResponse(response.status, response.body)
    }) as unknown as typeof fetch
    return { fetch: fetchImpl, calls }
  }

  const successBody = {
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'ok', cards: [], missing: [] }) } }],
  }

  it('sends reasoning_effort only when configured', async () => {
    const withEffort = fetchReturning({ status: 200, body: successBody })
    const withEffortModel = createOpenAiCompatibleModel({ baseUrl: 'https://opencode.ai/zen/go/v1', apiKey: 'go-key', model: 'glm-5.3', reasoningEffort: 'low', fetch: withEffort.fetch })
    await withEffortModel.generate(baseInput)
    expect(JSON.parse(withEffort.calls[0]!.init.body).reasoning_effort).toBe('low')

    const without = fetchReturning({ status: 200, body: successBody })
    const withoutModel = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: without.fetch })
    await withoutModel.generate(baseInput)
    expect(JSON.parse(without.calls[0]!.init.body)).not.toHaveProperty('reasoning_effort')
  })

  it('parses the JSON content on success and requests json_schema structured output', async () => {
    const { fetch: fetchImpl, calls } = fetchReturning({ status: 200, body: successBody })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).resolves.toEqual({ summary: 'ok', cards: [], missing: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(calls[0]!.init.headers.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(calls[0]!.init.body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'deck_assistant', schema: baseInput.schema },
    })
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'stable context\n\nuser prompt' },
    ])
  })

  it('joins an array-of-parts message content', async () => {
    const body = {
      choices: [{
        finish_reason: 'stop',
        message: { content: [{ type: 'text', text: '{"summary":"ok",' }, { type: 'text', text: '"cards":[],"missing":[]}' }] },
      }],
    }
    const { fetch: fetchImpl } = fetchReturning({ status: 200, body })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).resolves.toEqual({ summary: 'ok', cards: [], missing: [] })
  })

  it('strips ``` fences around the JSON content', async () => {
    const body = {
      choices: [{ finish_reason: 'stop', message: { content: '```json\n{"summary":"ok","cards":[],"missing":[]}\n```' } }],
    }
    const { fetch: fetchImpl } = fetchReturning({ status: 200, body })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).resolves.toEqual({ summary: 'ok', cards: [], missing: [] })
  })

  it('falls back from json_schema to json_object to no response_format on repeated 400s', async () => {
    const { fetch: fetchImpl, calls } = fetchReturning(
      { status: 400, body: { error: 'unsupported response_format' } },
      { status: 400, body: { error: 'still unsupported' } },
      { status: 200, body: successBody },
    )
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).resolves.toEqual({ summary: 'ok', cards: [], missing: [] })
    expect(calls).toHaveLength(3)

    const firstBody = JSON.parse(calls[0]!.init.body)
    expect(firstBody.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'deck_assistant', schema: baseInput.schema } })

    const secondBody = JSON.parse(calls[1]!.init.body)
    expect(secondBody.response_format).toEqual({ type: 'json_object' })
    expect(secondBody.messages[0].content).toContain('Antworte ausschließlich mit einem JSON-Objekt nach diesem Schema:')

    const thirdBody = JSON.parse(calls[2]!.init.body)
    expect(thirdBody.response_format).toBeUndefined()
    expect(thirdBody.messages[0].content).toBe('system prompt')
  })

  it('also falls back on a 422 response', async () => {
    const { fetch: fetchImpl, calls } = fetchReturning(
      { status: 422, body: { error: 'unprocessable' } },
      { status: 200, body: successBody },
    )
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).resolves.toEqual({ summary: 'ok', cards: [], missing: [] })
    expect(calls).toHaveLength(2)
  })

  it('maps 401/403 to a 503 configuration error', async () => {
    const { fetch: fetchImpl } = fetchReturning({ status: 401, body: { error: 'invalid api key' } })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-bad', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'KI-Assistent ist nicht korrekt konfiguriert.',
    })
  })

  it('maps 429 to a 503 "ausgelastet" error', async () => {
    const { fetch: fetchImpl } = fetchReturning({ status: 429, body: { error: 'rate limited' } })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Der KI-Assistent ist ausgelastet, bitte später erneut versuchen.',
    })
  })

  it('maps a generic 500 to a 502 "nicht erreichbar" error', async () => {
    const { fetch: fetchImpl } = fetchReturning({ status: 500, body: { error: 'server error' } })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Der KI-Assistent ist derzeit nicht erreichbar.',
    })
  })

  it('maps a network error to a 502', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).rejects.toMatchObject({ statusCode: 502 })
  })

  it('maps a timeout (AbortError) to a 502', async () => {
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

      const pending = expect(model.generate(baseInput)).rejects.toMatchObject({
        statusCode: 502,
        statusMessage: 'Der KI-Assistent ist derzeit nicht erreichbar.',
      })
      await vi.advanceTimersByTimeAsync(120_000)
      await pending
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('maps finish_reason "length" to a 502 "zu lang" error', async () => {
    const body = { choices: [{ finish_reason: 'length', message: { content: '' } }] }
    const { fetch: fetchImpl } = fetchReturning({ status: 200, body })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Die Antwort des Assistenten war zu lang oder unvollständig.',
    })
  })

  it('maps finish_reason "content_filter" to a 502 "abgelehnt" error', async () => {
    const body = { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }
    const { fetch: fetchImpl } = fetchReturning({ status: 200, body })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Der Assistent hat die Anfrage abgelehnt.',
    })
  })

  it('throws a 502 when the content is not valid JSON', async () => {
    const body = { choices: [{ finish_reason: 'stop', message: { content: 'not json at all' } }] }
    const { fetch: fetchImpl } = fetchReturning({ status: 200, body })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini', fetch: fetchImpl })

    await expect(model.generate(baseInput)).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Ungültige Antwort des Assistenten.',
    })
  })

  it('omits the Authorization header when the api key is empty (keyless local servers)', async () => {
    const { fetch: fetchImpl, calls } = fetchReturning({ status: 200, body: successBody })
    const model = createOpenAiCompatibleModel({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3', fetch: fetchImpl })

    await model.generate(baseInput)

    expect(calls[0]!.init.headers.authorization).toBeUndefined()
  })

  it('strips a trailing slash from the base URL', async () => {
    const { fetch: fetchImpl, calls } = fetchReturning({ status: 200, body: successBody })
    const model = createOpenAiCompatibleModel({ baseUrl: 'https://openrouter.ai/api/v1/', apiKey: 'sk-test', model: 'openai/gpt-4o-mini', fetch: fetchImpl })

    await model.generate(baseInput)

    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })
})
