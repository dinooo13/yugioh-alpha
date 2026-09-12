import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { addOwnedCard, ownedQuantitiesByCard, validateInventoryInput } from '../../server/utils/inventory'
import { createCollection } from '../../server/utils/collections'
import { createDeck, getDeckDetail, listDecks, updateDeck, upsertDeckCard } from '../../server/utils/decks'
import { createRuleFormat, deleteRuleFormat, seedBuiltinFormats, validateRuleFormatInput } from '../../server/utils/rule-formats'
import {
  applyAction,
  ASSISTANT_TOOL_RESULT_MAX_ITEMS,
  ASSISTANT_TOOLS,
  rejectAction,
  runTool,
  toolDefinitions,
} from '../../server/utils/assistant-tools'
import type { ToolOutcome } from '../../server/utils/assistant-tools'
import type { AssistantActionKind } from '../../shared/assistant-chat'

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

function own(db: TestDb, userId: string, catalogCardId: number, quantity: number, extra: Record<string, unknown> = {}) {
  return addOwnedCard(db, userId, validateInventoryInput({ catalog_card_id: catalogCardId, quantity, ...extra }))
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

function tool(name: string) {
  return ASSISTANT_TOOLS.find(candidate => candidate.name === name)!
}

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  seedUsersAndCatalog(db)
})

describe('toolDefinitions', () => {
  it('exposes every tool as an OpenAI-style function definition', () => {
    const definitions = toolDefinitions()
    expect(definitions).toHaveLength(ASSISTANT_TOOLS.length)
    for (const definition of definitions) {
      expect(definition.type).toBe('function')
      expect(typeof definition.function.name).toBe('string')
      expect(typeof definition.function.description).toBe('string')
      expect(typeof definition.function.parameters).toBe('object')
    }
  })
})

describe('runTool', () => {
  it('rejects an unknown tool name with 400', async () => {
    expect(await statusOf(() => runTool('does_not_exist', { db, userId: 'user-a' }, {}))).toBe(400)
  })
})

describe('search_catalog', () => {
  it('finds cards by a name substring and includes stats', async () => {
    const outcome = await tool('search_catalog').run({ db, userId: 'user-a' }, { query: 'Dark Mag' })
    expect(outcome.result).toMatchObject({
      items: [
        expect.objectContaining({ id: CARD.darkMagician, name: 'Dark Magician', type: 'Normal Monster', atk: 2500, def: 2100 }),
      ],
      truncated: false,
    })
  })

  it('rejects non-object arguments', async () => {
    expect(await statusOf(() => tool('search_catalog').run({ db, userId: 'user-a' }, 'nope'))).toBe(400)
  })

  it('caps the result at ASSISTANT_TOOL_RESULT_MAX_ITEMS and respects a smaller limit', async () => {
    const now = new Date()
    const extraCards = Array.from({ length: 25 }, (_, i) => ({
      id: 90_000_000 + i,
      name: `Filler Card ${String(i).padStart(2, '0')}`,
      type: 'Normal Monster',
      desc: 'x',
      syncedAt: now,
    }))
    db.insert(schema.catalogCard).values(extraCards).run()

    const full = await tool('search_catalog').run({ db, userId: 'user-a' }, { query: 'Filler Card' })
    const fullResult = full.result as { items: unknown[], truncated: boolean }
    expect(fullResult.items).toHaveLength(ASSISTANT_TOOL_RESULT_MAX_ITEMS)
    expect(fullResult.truncated).toBe(true)

    const limited = await tool('search_catalog').run({ db, userId: 'user-a' }, { query: 'Filler Card', limit: 3 })
    const limitedResult = limited.result as { items: unknown[], truncated: boolean }
    expect(limitedResult.items).toHaveLength(3)
    expect(limitedResult.truncated).toBe(true)
  })
})

describe('get_card', () => {
  it('returns full card data including printings and banlist info', async () => {
    const outcome = await tool('get_card').run({ db, userId: 'user-a' }, { id: CARD.darkMagician })
    expect(outcome.result).toMatchObject({ id: CARD.darkMagician, name: 'Dark Magician', desc: 'The ultimate wizard.' })
    expect((outcome.result as { printings: unknown[] }).printings).toEqual([])
  })

  it('404s for an unknown card id', async () => {
    expect(await statusOf(() => tool('get_card').run({ db, userId: 'user-a' }, { id: 1 }))).toBe(404)
  })

  it('rejects a missing id', async () => {
    expect(await statusOf(() => tool('get_card').run({ db, userId: 'user-a' }, {}))).toBe(400)
  })
})

describe('search_inventory', () => {
  it('aggregates owned quantities per card across collections', async () => {
    const collectionA = await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    await own(db, 'user-a', CARD.darkMagician, 2, { collection_id: collectionA.id })
    await own(db, 'user-a', CARD.darkMagician, 1)
    await own(db, 'user-a', CARD.potOfGreed, 3)

    const outcome = await tool('search_inventory').run({ db, userId: 'user-a' }, {})
    const { items } = outcome.result as { items: Array<{ catalogCardId: number, quantity: number, collections: unknown[] }> }
    const byCard = new Map(items.map(row => [row.catalogCardId, row]))

    expect(byCard.get(CARD.darkMagician)).toMatchObject({ name: 'Dark Magician', quantity: 3 })
    expect(byCard.get(CARD.darkMagician)!.collections).toEqual([{ id: collectionA.id, name: 'Box 1', quantity: 2 }])
    expect(byCard.get(CARD.potOfGreed)).toMatchObject({ quantity: 3 })
  })

  it('filters by query and by collection, and never sees another user\'s cards', async () => {
    await own(db, 'user-a', CARD.darkMagician, 1)
    await own(db, 'user-b', CARD.potOfGreed, 5)

    const byQuery = await tool('search_inventory').run({ db, userId: 'user-a' }, { query: 'Dark' })
    expect(byQuery.result).toMatchObject({ items: [expect.objectContaining({ catalogCardId: CARD.darkMagician })] })

    const byQueryMiss = await tool('search_inventory').run({ db, userId: 'user-a' }, { query: 'Pot of Greed' })
    expect(byQueryMiss.result).toMatchObject({ items: [] })
  })

  it('404s for a collectionId the caller does not own', async () => {
    const foreign = await createCollection(db, 'user-b', { name: 'Foreign', description: null })
    expect(await statusOf(() => tool('search_inventory').run({ db, userId: 'user-a' }, { collectionId: foreign.id }))).toBe(404)
  })
})

describe('list_collections', () => {
  it('lists the caller\'s collections with card counts', async () => {
    const collection = await createCollection(db, 'user-a', { name: 'Box 1', description: null })
    await own(db, 'user-a', CARD.darkMagician, 4, { collection_id: collection.id })
    await createCollection(db, 'user-b', { name: 'Not mine', description: null })

    const outcome = await tool('list_collections').run({ db, userId: 'user-a' }, {})
    expect(outcome.result).toMatchObject({ items: [{ id: collection.id, name: 'Box 1', cardCount: 4 }], truncated: false })
  })
})

describe('list_decks', () => {
  it('lists the caller\'s decks with counts and legality', async () => {
    const deck = createDeck(db, 'user-a', { name: 'My Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 })
    createDeck(db, 'user-b', { name: 'Not mine', description: null })

    const outcome = await tool('list_decks').run({ db, userId: 'user-a' }, {})
    expect(outcome.result).toMatchObject({
      items: [
        expect.objectContaining({ id: deck.id, name: 'My Deck', formatName: null, legal: null, counts: { main: 1, extra: 0, side: 0, total: 1 } }),
      ],
      truncated: false,
      total: 1,
    })
  })

  it('filters by query', async () => {
    createDeck(db, 'user-a', { name: 'Blue-Eyes Deck', description: null })
    createDeck(db, 'user-a', { name: 'Burn Deck', description: null })

    const outcome = await tool('list_decks').run({ db, userId: 'user-a' }, { query: 'Blue-Eyes' })
    const { items } = outcome.result as { items: Array<{ name: string }> }
    expect(items.map(item => item.name)).toEqual(['Blue-Eyes Deck'])
  })
})

describe('get_deck', () => {
  it('returns sections, ownership, and a validation summary', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({
      name: 'Format',
      rules: { rules: [{ kind: 'copies', maxCopies: 3 }] },
    }))
    const deck = createDeck(db, 'user-a', { name: 'My Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 })
    updateDeck(db, 'user-a', deck.id, { formatId: format.id })
    await own(db, 'user-a', CARD.darkMagician, 1)

    const outcome = await tool('get_deck').run({ db, userId: 'user-a' }, { id: deck.id })
    expect(outcome.result).toMatchObject({
      id: deck.id,
      name: 'My Deck',
      formatName: 'Format',
      sections: {
        main: [{ catalogCardId: CARD.darkMagician, name: 'Dark Magician', section: 'main', quantity: 1, owned: 1 }],
        extra: [],
        side: [],
      },
      validation: { legal: true },
    })
  })

  it('404s for a deck owned by another user', async () => {
    const foreignDeck = createDeck(db, 'user-b', { name: 'Foreign', description: null })
    expect(await statusOf(() => tool('get_deck').run({ db, userId: 'user-a' }, { id: foreignDeck.id }))).toBe(404)
  })
})

describe('list_formats', () => {
  it('lists built-in and the caller\'s own formats', async () => {
    seedBuiltinFormats(db)
    createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Mein Format', rules: { rules: [] } }))
    const outcome = await tool('list_formats').run({ db, userId: 'user-a' }, {})
    const { items: names } = outcome.result as { items: Array<{ name: string, isBuiltin: boolean }> }
    expect(names.some(item => item.isBuiltin)).toBe(true)
    expect(names.some(item => item.name === 'Mein Format' && !item.isBuiltin)).toBe(true)
  })
})

describe('validate_deck', () => {
  it('validates against the deck\'s own assigned format', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({
      name: 'Format',
      rules: { rules: [{ kind: 'copies', maxCopies: 1 }] },
    }))
    const deck = createDeck(db, 'user-a', { name: 'My Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 })
    updateDeck(db, 'user-a', deck.id, { formatId: format.id })

    const outcome = await tool('validate_deck').run({ db, userId: 'user-a' }, { deckId: deck.id })
    expect((outcome.result as { legal: boolean }).legal).toBe(false)
  })

  it('validates against an explicit formatId even without an assigned format', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Format', rules: { rules: [] } }))
    const deck = createDeck(db, 'user-a', { name: 'My Deck', description: null })

    const outcome = await tool('validate_deck').run({ db, userId: 'user-a' }, { deckId: deck.id, formatId: format.id })
    expect((outcome.result as { legal: boolean }).legal).toBe(true)
  })

  it('400s when the deck has no format and none was given', async () => {
    const deck = createDeck(db, 'user-a', { name: 'My Deck', description: null })
    expect(await statusOf(() => tool('validate_deck').run({ db, userId: 'user-a' }, { deckId: deck.id }))).toBe(400)
  })
})

describe('add_to_inventory (write tool)', () => {
  it('produces a pending action instead of writing directly', async () => {
    const outcome = await tool('add_to_inventory').run({ db, userId: 'user-a' }, {
      items: [{ catalogCardId: CARD.darkMagician, quantity: 2 }],
    })

    expect('action' in outcome).toBe(true)
    const withAction = outcome as Extract<ToolOutcome, { action: unknown }>
    expect(withAction.action.kind).toBe('add_to_inventory')
    expect(withAction.action.summary).toContain('Dark Magician')
    expect(ownedQuantitiesByCard(db, 'user-a', [CARD.darkMagician]).get(CARD.darkMagician)).toBeUndefined()
  })

  it('400s for an unknown catalog card id', async () => {
    expect(await statusOf(() => tool('add_to_inventory').run({ db, userId: 'user-a' }, {
      items: [{ catalogCardId: 1, quantity: 1 }],
    }))).toBe(400)
  })
})

describe('create_deck (write tool)', () => {
  it('produces a pending action and never creates the deck', async () => {
    const outcome = await tool('create_deck').run({ db, userId: 'user-a' }, {
      name: 'Neues Deck',
      cards: [{ catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 }],
    })

    const withAction = outcome as Extract<ToolOutcome, { action: unknown }>
    expect(withAction.action.kind).toBe('create_deck')
    expect(withAction.action.payload).toMatchObject({ name: 'Neues Deck' })
    expect(withAction.action.summary).toContain('Neues Deck')
  })

  it('400s for a card placed in the wrong section', async () => {
    expect(await statusOf(() => tool('create_deck').run({ db, userId: 'user-a' }, {
      name: 'Neues Deck',
      cards: [{ catalogCardId: CARD.stardustDragon, section: 'main', quantity: 1 }],
    }))).toBe(400)
  })

  it('400s for an unknown catalog card id', async () => {
    expect(await statusOf(() => tool('create_deck').run({ db, userId: 'user-a' }, {
      name: 'Neues Deck',
      cards: [{ catalogCardId: 1, section: 'main', quantity: 1 }],
    }))).toBe(400)
  })
})

describe('update_deck_cards (write tool)', () => {
  it('produces a pending action referencing the deck\'s current name', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Mein Deck', description: null })
    const outcome = await tool('update_deck_cards').run({ db, userId: 'user-a' }, {
      deckId: deck.id,
      changes: [{ catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 }],
    })

    const withAction = outcome as Extract<ToolOutcome, { action: unknown }>
    expect(withAction.action.kind).toBe('update_deck_cards')
    expect(withAction.action.summary).toContain('Mein Deck')
  })

  it('404s for a deck owned by another user', async () => {
    const foreignDeck = createDeck(db, 'user-b', { name: 'Foreign', description: null })
    expect(await statusOf(() => tool('update_deck_cards').run({ db, userId: 'user-a' }, {
      deckId: foreignDeck.id,
      changes: [{ catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 }],
    }))).toBe(404)
  })

  it('400s for an empty changes array', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Mein Deck', description: null })
    expect(await statusOf(() => tool('update_deck_cards').run({ db, userId: 'user-a' }, { deckId: deck.id, changes: [] }))).toBe(400)
  })
})

describe('applyAction', () => {
  let pendingActionCounter = 0

  /** Inserts a pending `assistant_action` row directly — the conversation/message it references are incidental to these tests. */
  function insertPendingAction(userId: string, kind: AssistantActionKind, payload: Record<string, unknown>, summary = 'Test') {
    pendingActionCounter += 1
    const n = pendingActionCounter
    const conversation = db.insert(schema.assistantConversation).values({
      id: `conv-${n}`, userId, title: 'Test', createdAt: new Date(), updatedAt: new Date(),
    }).returning().all()[0]!
    const message = db.insert(schema.assistantMessage).values({
      id: `msg-${n}`, conversationId: conversation.id, role: 'assistant', content: '', createdAt: new Date(),
    }).returning().all()[0]!
    return db.insert(schema.assistantAction).values({
      id: `action-${n}`,
      conversationId: conversation.id,
      messageId: message.id,
      userId,
      kind,
      payload,
      summary,
      status: 'pending',
      createdAt: new Date(),
    }).returning().all()[0]!
  }

  async function proposeAddToInventory(userId: string, quantity = 2) {
    const outcome = await tool('add_to_inventory').run({ db, userId }, {
      items: [{ catalogCardId: CARD.darkMagician, quantity }],
    })
    const action = (outcome as Extract<ToolOutcome, { action: unknown }>).action
    return insertPendingAction(userId, action.kind, action.payload, action.summary)
  }

  it('applies an add_to_inventory action and marks it applied', async () => {
    const action = await proposeAddToInventory('user-a', 2)
    const updated = await applyAction(db, 'user-a', action.id)

    expect(updated.status).toBe('applied')
    expect(ownedQuantitiesByCard(db, 'user-a', [CARD.darkMagician]).get(CARD.darkMagician)).toBe(2)
  })

  it('409s when applying an already-resolved action', async () => {
    const action = await proposeAddToInventory('user-a')
    await applyAction(db, 'user-a', action.id)

    expect(await statusOf(() => applyAction(db, 'user-a', action.id))).toBe(409)
  })

  it('404s for an action belonging to another user', async () => {
    const action = await proposeAddToInventory('user-a')
    expect(await statusOf(() => applyAction(db, 'user-b', action.id))).toBe(404)
  })

  it('marks the action failed (not thrown) when the payload can no longer be applied', async () => {
    const action = await proposeAddToInventory('user-a')
    // The catalog card referenced by the payload disappears before it is applied.
    db.delete(schema.catalogCard).where(eq(schema.catalogCard.id, CARD.darkMagician)).run()

    const updated = await applyAction(db, 'user-a', action.id)
    expect(updated.status).toBe('failed')
    expect(updated.result).toMatchObject({ error: expect.any(String) })
  })

  it('a concurrent double apply: exactly one call succeeds, the other 409s, and the write happens once', async () => {
    const action = await proposeAddToInventory('user-a', 2)

    const results = await Promise.allSettled([
      applyAction(db, 'user-a', action.id),
      applyAction(db, 'user-a', action.id),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect((rejected[0]!.reason as { statusCode?: number }).statusCode).toBe(409)

    // Applied exactly once — not twice.
    expect(ownedQuantitiesByCard(db, 'user-a', [CARD.darkMagician]).get(CARD.darkMagician)).toBe(2)
  })

  it('rolls back the whole payload (no orphan deck) when create_deck succeeds but the format assignment fails', async () => {
    const format = createRuleFormat(db, 'user-a', validateRuleFormatInput({ name: 'Format', rules: { rules: [] } }))
    const outcome = await tool('create_deck').run({ db, userId: 'user-a' }, {
      name: 'Rollback Deck',
      formatId: format.id,
      cards: [{ catalogCardId: CARD.darkMagician, section: 'main', quantity: 1 }],
    })
    const action = (outcome as Extract<ToolOutcome, { action: unknown }>).action
    const row = insertPendingAction('user-a', action.kind, action.payload, action.summary)

    // The format is removed after the action was proposed but before it's applied —
    // `createDeck` would still succeed on its own; the format assignment that
    // follows fails, and the whole transaction (including the deck row) must
    // roll back rather than leaving an orphan, unassigned deck behind.
    deleteRuleFormat(db, 'user-a', format.id)

    const updated = await applyAction(db, 'user-a', row.id)
    expect(updated.status).toBe('failed')

    const decks = listDecks(db, 'user-a', {}).items
    expect(decks.some(deckItem => deckItem.name === 'Rollback Deck')).toBe(false)
  })

  it('re-validates a create_deck payload at apply time and creates nothing for an out-of-bounds quantity', async () => {
    // Simulates a payload row tampered with (or corrupted) after proposal —
    // the tool layer would never itself produce a quantity this large.
    const row = insertPendingAction('user-a', 'create_deck', {
      name: 'Sneaky Deck',
      description: null,
      formatId: null,
      cards: [{ catalogCardId: CARD.darkMagician, section: 'main', quantity: 5000 }],
    })

    const updated = await applyAction(db, 'user-a', row.id)
    expect(updated.status).toBe('failed')

    const decks = listDecks(db, 'user-a', {}).items
    expect(decks.some(deckItem => deckItem.name === 'Sneaky Deck')).toBe(false)
  })

  it('re-validates an update_deck_cards payload at apply time and changes nothing for an out-of-bounds quantity', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Mein Deck', description: null })
    const row = insertPendingAction('user-a', 'update_deck_cards', {
      deckId: deck.id,
      changes: [{ catalogCardId: CARD.darkMagician, section: 'main', quantity: 5000 }],
    })

    const updated = await applyAction(db, 'user-a', row.id)
    expect(updated.status).toBe('failed')
    expect(getDeckDetail(db, 'user-a', deck.id).sections.main).toEqual([])
  })

  it('does not partially apply a batch of deck-card changes when one entry is invalid', async () => {
    const deck = createDeck(db, 'user-a', { name: 'Mein Deck', description: null })
    const outcome = await tool('update_deck_cards').run({ db, userId: 'user-a' }, {
      deckId: deck.id,
      changes: [
        { catalogCardId: CARD.darkMagician, section: 'main', quantity: 2 },
        { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 1 },
      ],
    })
    const action = (outcome as Extract<ToolOutcome, { action: unknown }>).action
    const row = insertPendingAction('user-a', action.kind, action.payload, action.summary)

    // The catalog changes between proposal and apply — Pot of Greed disappears.
    db.delete(schema.catalogCard).where(eq(schema.catalogCard.id, CARD.potOfGreed)).run()

    const updated = await applyAction(db, 'user-a', row.id)
    expect(updated.status).toBe('failed')
    // Dark Magician would have succeeded on its own, but the batch fails
    // together — no partial deck changes.
    expect(getDeckDetail(db, 'user-a', deck.id).sections.main).toEqual([])
  })
})

describe('rejectAction', () => {
  it('marks a pending action rejected', async () => {
    const outcome = await tool('add_to_inventory').run({ db, userId: 'user-a' }, {
      items: [{ catalogCardId: CARD.darkMagician, quantity: 1 }],
    })
    const action = (outcome as Extract<ToolOutcome, { action: unknown }>).action
    const conversation = db.insert(schema.assistantConversation).values({
      id: 'conv-2', userId: 'user-a', title: 'Test', createdAt: new Date(), updatedAt: new Date(),
    }).returning().all()[0]!
    const message = db.insert(schema.assistantMessage).values({
      id: 'msg-2', conversationId: conversation.id, role: 'assistant', content: '', createdAt: new Date(),
    }).returning().all()[0]!
    const row = db.insert(schema.assistantAction).values({
      id: 'action-2',
      conversationId: conversation.id,
      messageId: message.id,
      userId: 'user-a',
      kind: action.kind,
      payload: action.payload,
      summary: action.summary,
      status: 'pending',
      createdAt: new Date(),
    }).returning().all()[0]!

    const updated = rejectAction(db, 'user-a', row.id)
    expect(updated.status).toBe('rejected')
    expect(await statusOf(async () => rejectAction(db, 'user-a', row.id))).toBe(409)
  })
})
