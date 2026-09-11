import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it } from 'vitest'
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
  createAnthropicModel,
  createFakeModel,
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
  it('resolves to fake, anthropic-by-key, or disabled', () => {
    const config = useRuntimeConfig().assistant as { provider: string, apiKey: string, model: string, effort: string }
    const original = { ...config }

    try {
      config.provider = 'fake'
      expect(getDeckAssistantStatus()).toEqual({ enabled: true, provider: 'fake', model: 'fake' })
      expect(useDeckAssistantModel()?.id).toBe('fake')

      config.provider = ''
      config.apiKey = 'sk-test-key'
      config.model = ''
      expect(getDeckAssistantStatus()).toEqual({ enabled: true, provider: 'anthropic', model: 'claude-opus-5' })

      config.apiKey = ''
      expect(getDeckAssistantStatus()).toEqual({ enabled: false, provider: null, model: null })
      expect(useDeckAssistantModel()).toBeNull()
    }
    finally {
      Object.assign(config, original)
    }
  })
})

describe('Anthropic model', () => {
  // `generate` uses `client.beta.messages.stream(...)`, a synchronous call
  // that returns a stream object; the typed errors and the final parsed
  // message surface from awaiting `finalMessage()`.
  function mockClient(finalMessage: () => Promise<unknown>) {
    return { beta: { messages: { stream: () => ({ finalMessage }) } } } as unknown as Anthropic
  }

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

  it('parses the JSON text block on success', async () => {
    const client = mockClient(async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ summary: 'ok', cards: [], missing: [] }) }],
    }))
    const model = createAnthropicModel({ model: 'claude-opus-5', effort: 'high', client })

    await expect(model.generate(baseInput)).resolves.toEqual({ summary: 'ok', cards: [], missing: [] })
  })

  it('uses the LAST text block, not the first, when a fallback hop precedes the real answer', async () => {
    const fallbackBlock: Anthropic.Beta.BetaFallbackBlock = {
      type: 'fallback',
      from: { model: 'claude-opus-5' },
      to: { model: 'claude-sonnet-5' },
      trigger: { type: 'refusal', category: null },
    }
    const client = mockClient(async () => ({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'partial garbage before the refusal' },
        fallbackBlock,
        { type: 'text', text: JSON.stringify({ summary: 'ok', cards: [], missing: [] }) },
      ],
    }))
    const model = createAnthropicModel({ model: 'claude-opus-5', effort: 'high', client })

    await expect(model.generate(baseInput)).resolves.toEqual({ summary: 'ok', cards: [], missing: [] })
  })

  it('throws a German error on a refusal stop_reason', async () => {
    const client = mockClient(async () => ({ stop_reason: 'refusal', content: [] }))
    const model = createAnthropicModel({ model: 'claude-opus-5', effort: 'high', client })

    await expect(model.generate(baseInput)).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Der Assistent hat die Anfrage abgelehnt.',
    })
  })

  it('throws a German error on a max_tokens stop_reason', async () => {
    const client = mockClient(async () => ({ stop_reason: 'max_tokens', content: [] }))
    const model = createAnthropicModel({ model: 'claude-opus-5', effort: 'high', client })

    await expect(model.generate(baseInput)).rejects.toMatchObject({ statusCode: 502 })
  })

  it('throws a 502 when the text block is not valid JSON', async () => {
    const client = mockClient(async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json at all' }],
    }))
    const model = createAnthropicModel({ model: 'claude-opus-5', effort: 'high', client })

    await expect(model.generate(baseInput)).rejects.toMatchObject({ statusCode: 502 })
  })

  it('maps AuthenticationError, RateLimitError, and a generic APIError', async () => {
    const authClient = mockClient(async () => {
      throw new Anthropic.AuthenticationError(401, {}, 'invalid api key', new Headers())
    })
    await expect(createAnthropicModel({ model: 'claude-opus-5', effort: 'high', client: authClient }).generate(baseInput))
      .rejects.toMatchObject({ statusCode: 503 })

    const rateLimitClient = mockClient(async () => {
      throw new Anthropic.RateLimitError(429, {}, 'slow down', new Headers())
    })
    await expect(createAnthropicModel({ model: 'claude-opus-5', effort: 'high', client: rateLimitClient }).generate(baseInput))
      .rejects.toMatchObject({ statusCode: 503 })

    const apiErrorClient = mockClient(async () => {
      throw Anthropic.APIError.generate(500, {}, 'server error', new Headers())
    })
    await expect(createAnthropicModel({ model: 'claude-opus-5', effort: 'high', client: apiErrorClient }).generate(baseInput))
      .rejects.toMatchObject({ statusCode: 502 })
  })
})
