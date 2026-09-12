import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../server/db/schema'
import { createDeck, deleteDeck, upsertDeckCard } from '../../server/utils/decks'
import { seedBuiltinFormats } from '../../server/utils/rule-formats'
import {
  addParticipant,
  completeRound,
  createNextRound,
  createTournament,
  deleteTournament,
  finishTournament,
  getTournamentDetail,
  listTournaments,
  registerParticipantDeck,
  removeParticipant,
  reportMatchResult,
  startTournament,
  swapPairing,
  updateParticipant,
  updateTournament,
  validateParticipantInput,
  validateTournamentInput,
} from '../../server/utils/tournaments'
import { MAX_PARTICIPANTS } from '../../shared/tournaments'
import type { TournamentDetail } from '../../shared/tournaments'

const CARD = {
  darkMagician: 46986414,
  potOfGreed: 55144522,
  mirrorForce: 44095762,
  stardustDragon: 44508094,
  kuriboh: 40640057,
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
    { id: 'user-c', name: 'User C', email: 'c@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()

  db.insert(schema.catalogCard).values([
    { id: CARD.darkMagician, name: 'Dark Magician', type: 'Normal Monster', frameType: 'normal', desc: 'The ultimate wizard.', attribute: 'DARK', level: 7, syncedAt: now },
    { id: CARD.potOfGreed, name: 'Pot of Greed', type: 'Spell Card', frameType: 'spell', desc: 'Draw two cards.', syncedAt: now },
    { id: CARD.mirrorForce, name: 'Mirror Force', type: 'Trap Card', frameType: 'trap', desc: 'Destroy all attacking monsters.', syncedAt: now },
    { id: CARD.stardustDragon, name: 'Stardust Dragon', type: 'Synchro Monster', frameType: 'synchro', desc: 'Tuner + 1 or more non-Tuner monsters.', attribute: 'WIND', level: 8, syncedAt: now },
    { id: CARD.kuriboh, name: 'Kuriboh', type: 'Normal Monster', frameType: 'normal', desc: 'It can be sacrificed...', attribute: 'DARK', level: 1, syncedAt: now },
  ]).run()

  seedBuiltinFormats(db)
}

/** A small (illegal-by-size) deck: 10 cards total, well under the 40-card main minimum. */
function buildSmallDeck(db: TestDb, userId: string, name = 'Kleines Deck') {
  return createDeck(db, userId, { name, description: null }, [
    { catalogCardId: CARD.darkMagician, section: 'main', quantity: 3 },
    { catalogCardId: CARD.potOfGreed, section: 'main', quantity: 3 },
    { catalogCardId: CARD.mirrorForce, section: 'main', quantity: 3 },
    { catalogCardId: CARD.stardustDragon, section: 'extra', quantity: 1 },
  ])
}

/** A rule format with no rules at all — every deck is legal against it. */
function insertNoLimitFormat(db: TestDb, id = 'no-limit-format') {
  const now = new Date()
  db.insert(schema.ruleFormat).values({
    id,
    userId: null,
    name: 'Ohne Limit',
    description: null,
    rules: { rules: [] },
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  }).run()
  return id
}

function reportBothMatches(db: TestDb, id: string, detail: TournamentDetail) {
  const round = detail.currentRound!
  let latest = detail
  for (const match of round.matches) {
    if (match.isBye) {
      continue
    }
    latest = reportMatchResult(db, 'user-a', id, match.id, { gamesA: 2, gamesB: 0 })
  }
  return latest
}

describe('tournament creation', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('creates a tournament with default status/pairing/plannedRounds and includes the organizer', () => {
    const detail = createTournament(db, 'user-a', validateTournamentInput({ name: 'Freitagsturnier' }))

    expect(detail.status).toBe('registration')
    expect(detail.pairingSystem).toBe('swiss')
    expect(detail.plannedRounds).toBeNull()
    expect(detail.participants).toHaveLength(1)
    expect(detail.participants[0]).toMatchObject({ seed: 1, linked: true, isSelf: true, name: 'User A' })
  })

  it('does not add the organizer when includeSelf is false', () => {
    const detail = createTournament(db, 'user-a', validateTournamentInput({ name: 'Ohne mich', includeSelf: false }))
    expect(detail.participants).toHaveLength(0)
  })

  it('rejects an unknown formatId', () => {
    const input = validateTournamentInput({ name: 'Turnier', formatId: 'does-not-exist' })
    expect(() => createTournament(db, 'user-a', input))
      .toThrow(expect.objectContaining({ statusCode: 400, data: { code: 'unknown_format' } }))
  })

  it('rejects a blank name', () => {
    expect(() => validateTournamentInput({ name: '   ' }))
      .toThrow(expect.objectContaining({ statusCode: 400, data: { code: 'invalid_name' } }))
  })
})

describe('tournament access', () => {
  let db: TestDb
  let id: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Zugriffstest' })).id
  })

  it('reports 404 for an outsider', () => {
    expect(() => getTournamentDetail(db, 'user-c', id))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
  })

  it('gives a linked participant read access with their own selfParticipantId', () => {
    addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' }))

    const detail = getTournamentDetail(db, 'user-b', id)
    expect(detail.role).toBe('participant')
    expect(detail.selfParticipantId).not.toBeNull()
  })

  it('rejects organizer-only operations from a linked participant', () => {
    addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' }))

    expect(() => updateTournament(db, 'user-b', id, { name: 'Umbenannt' }))
      .toThrow(expect.objectContaining({ statusCode: 403, data: { code: 'organizer_only' } }))
  })
})

describe('participants', () => {
  let db: TestDb
  let id: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Teilnehmer', includeSelf: false })).id
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds a participant by email, case-insensitively, and never leaks the email', () => {
    const detail = addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'B@Example.com' }))

    const participant = detail.participants.find(p => p.linked)!
    expect(participant.name).toBe('User B')
    expect(JSON.stringify(detail).includes('@example.com')).toBe(false)
  })

  it('rejects an unknown email', () => {
    expect(() => addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'nobody@example.com' })))
      .toThrow(expect.objectContaining({ statusCode: 400, data: { code: 'user_not_found' } }))
  })

  it('rejects adding the same linked user twice', () => {
    addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' }))
    expect(() => addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' })))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'participant_exists' } }))
  })

  it('adds a guest and rejects a duplicate guest name', () => {
    const detail = addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Alice' }))
    expect(detail.participants).toHaveLength(1)
    expect(detail.participants[0]).toMatchObject({ linked: false, name: 'Alice' })

    expect(() => addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'alice' })))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'participant_exists' } }))
  })

  it('rejects removing a participant once the tournament is running', () => {
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Alice' }))
    const detail = addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Bob' }))
    const participantId = detail.participants[0]!.id
    startTournament(db, 'user-a', id)

    expect(() => removeParticipant(db, 'user-a', id, participantId))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'registration_closed' } }))
  })

  it('rejects a participant beyond MAX_PARTICIPANTS', () => {
    for (let i = 0; i < MAX_PARTICIPANTS; i++) {
      addParticipant(db, 'user-a', id, validateParticipantInput({ name: `Gast ${i}` }))
    }
    expect(() => addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Once too many' })))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'too_many_participants' } }))
  })

  it('renumbers seeds contiguously after removing a participant during registration', () => {
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Alice' }))
    const afterBob = addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Bob' }))
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Carla' }))
    const bobId = afterBob.participants.find(p => p.name === 'Bob')!.id

    const detail = removeParticipant(db, 'user-a', id, bobId)

    // Was [1, 3] before the fix (Bob's seed 2 left a gap); now contiguous.
    expect(detail.participants.map(p => p.seed)).toEqual([1, 2])
    expect(detail.participants.map(p => p.name)).toEqual(['Alice', 'Carla'])
  })

  it('bumps tournament.updatedAt on every participant mutation', () => {
    // Fake timers give each step a strictly later, deterministic instant —
    // real-clock timestamps taken microseconds apart can tie and would let a
    // missing `updatedAt` bump pass unnoticed.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2999-01-01T00:00:00.000Z'))

    const rowUpdatedAt = () => db.select().from(schema.tournament).where(eq(schema.tournament.id, id)).get()!.updatedAt.getTime()

    const initial = rowUpdatedAt()

    vi.setSystemTime(new Date('2999-01-01T00:01:00.000Z'))
    const detail = addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Alice' }))
    expect(rowUpdatedAt()).toBeGreaterThan(initial)
    const afterAdd = rowUpdatedAt()

    const participantId = detail.participants[0]!.id
    vi.setSystemTime(new Date('2999-01-01T00:02:00.000Z'))
    updateParticipant(db, 'user-a', id, participantId, { name: 'Alicia' })
    expect(rowUpdatedAt()).toBeGreaterThan(afterAdd)
    const afterUpdate = rowUpdatedAt()

    vi.setSystemTime(new Date('2999-01-01T00:03:00.000Z'))
    removeParticipant(db, 'user-a', id, participantId)
    expect(rowUpdatedAt()).toBeGreaterThan(afterUpdate)
  })
})

describe('deck registration', () => {
  let db: TestDb
  let id: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Deckanmeldung', formatId: 'unlimited' })).id
    addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' }))
  })

  function organizerParticipantId(detail: TournamentDetail) {
    return detail.participants.find(p => p.isSelf)!.id
  }

  it('snapshots the organizer\'s deck, unaffected by later edits or deletion', () => {
    const deck = buildSmallDeck(db, 'user-a')
    let detail = getTournamentDetail(db, 'user-a', id)
    const participantId = organizerParticipantId(detail)

    detail = registerParticipantDeck(db, 'user-a', id, participantId, deck.id)
    const participant = detail.participants.find(p => p.id === participantId)!
    expect(participant.deckSnapshot).not.toBeNull()
    expect(participant.deckSnapshot!.sections.main).toHaveLength(3)
    expect(participant.deckSnapshot!.capturedAt).toEqual(expect.any(String))
    expect(participant.deckLegal).toBe(false)
    expect(participant.deckIssueCount).toBeGreaterThan(0)

    const snapshotBefore = JSON.stringify(participant.deckSnapshot)

    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: CARD.kuriboh, section: 'main', quantity: 2 })
    detail = getTournamentDetail(db, 'user-a', id)
    const afterEdit = detail.participants.find(p => p.id === participantId)!
    expect(JSON.stringify(afterEdit.deckSnapshot)).toBe(snapshotBefore)

    deleteDeck(db, 'user-a', deck.id)
    detail = getTournamentDetail(db, 'user-a', id)
    const afterDelete = detail.participants.find(p => p.id === participantId)!
    expect(afterDelete.deckId).toBeNull()
    expect(JSON.stringify(afterDelete.deckSnapshot)).toBe(snapshotBefore)
  })

  it('is legal against a format with no rules', () => {
    insertNoLimitFormat(db)
    updateTournament(db, 'user-a', id, { formatId: 'no-limit-format' })
    const deck = buildSmallDeck(db, 'user-a')

    let detail = getTournamentDetail(db, 'user-a', id)
    const participantId = organizerParticipantId(detail)
    detail = registerParticipantDeck(db, 'user-a', id, participantId, deck.id)

    const participant = detail.participants.find(p => p.id === participantId)!
    expect(participant.deckLegal).toBe(true)
    expect(participant.deckIssueCount).toBe(0)
  })

  it('lets a linked participant register their own deck', () => {
    const deck = buildSmallDeck(db, 'user-b')
    const detail = getTournamentDetail(db, 'user-a', id)
    const participantId = detail.participants.find(p => p.linked && !p.isSelf)!.id

    const updated = registerParticipantDeck(db, 'user-b', id, participantId, deck.id)
    expect(updated.participants.find(p => p.id === participantId)!.deckId).toBe(deck.id)
  })

  it('forbids the organizer from registering a deck for another user\'s row', () => {
    const deck = buildSmallDeck(db, 'user-a')
    const detail = getTournamentDetail(db, 'user-a', id)
    const participantId = detail.participants.find(p => p.linked && !p.isSelf)!.id

    expect(() => registerParticipantDeck(db, 'user-a', id, participantId, deck.id))
      .toThrow(expect.objectContaining({ statusCode: 403, data: { code: 'foreign_deck_owner' } }))
  })

  it('forbids a linked participant from registering a deck for another row', () => {
    const deck = buildSmallDeck(db, 'user-a')
    const detail = getTournamentDetail(db, 'user-a', id)
    const organizerId = organizerParticipantId(detail)

    expect(() => registerParticipantDeck(db, 'user-b', id, organizerId, deck.id))
      .toThrow(expect.objectContaining({ statusCode: 403, data: { code: 'organizer_only' } }))
  })

  it('rejects an empty deck', () => {
    const emptyDeck = createDeck(db, 'user-a', { name: 'Leer', description: null })
    const detail = getTournamentDetail(db, 'user-a', id)
    const participantId = organizerParticipantId(detail)

    expect(() => registerParticipantDeck(db, 'user-a', id, participantId, emptyDeck.id))
      .toThrow(expect.objectContaining({ statusCode: 400, data: { code: 'empty_deck' } }))
  })

  it('rejects a foreign deck id', () => {
    const foreignDeck = buildSmallDeck(db, 'user-b')
    const detail = getTournamentDetail(db, 'user-a', id)
    const participantId = organizerParticipantId(detail)

    expect(() => registerParticipantDeck(db, 'user-a', id, participantId, foreignDeck.id))
      .toThrow(expect.objectContaining({ statusCode: 400, data: { code: 'unknown_deck' } }))
  })

  it('rejects registering a deck after the tournament has started', () => {
    const deck = buildSmallDeck(db, 'user-a')
    const detail = getTournamentDetail(db, 'user-a', id)
    const participantId = organizerParticipantId(detail)
    startTournament(db, 'user-a', id)

    expect(() => registerParticipantDeck(db, 'user-a', id, participantId, deck.id))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'registration_closed' } }))
  })
})

describe('starting a tournament', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('rejects starting with fewer than two participants', () => {
    const id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Solo' })).id
    expect(() => startTournament(db, 'user-a', id))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'not_enough_participants' } }))
  })

  it('freezes seeds, resolves plannedRounds, and creates round 1', () => {
    const id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Quartett', includeSelf: false })).id
    for (const name of ['Alice', 'Bob', 'Carla']) {
      addParticipant(db, 'user-a', id, validateParticipantInput({ name }))
    }
    addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' }))

    const detail = startTournament(db, 'user-a', id)
    expect(detail.status).toBe('running')
    expect(detail.plannedRounds).toBe(2)
    expect(detail.participants.map(p => p.seed).sort()).toEqual([1, 2, 3, 4])
    expect(detail.rounds).toHaveLength(1)
    expect(detail.rounds[0]!.matches).toHaveLength(2)
  })

  it('always uses the full circle length for round robin, ignoring a smaller plannedRounds input', () => {
    const id = createTournament(db, 'user-a', validateTournamentInput({
      name: 'Rundlauf', includeSelf: false, pairingSystem: 'round_robin', plannedRounds: 2,
    })).id
    for (const name of ['Alice', 'Bob', 'Carla']) {
      addParticipant(db, 'user-a', id, validateParticipantInput({ name }))
    }
    addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' }))

    const detail = startTournament(db, 'user-a', id)
    expect(detail.plannedRounds).toBe(3)
  })

  it('rejects starting an already-running tournament', () => {
    const id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Doppelt' })).id
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Alice' }))
    startTournament(db, 'user-a', id)

    expect(() => startTournament(db, 'user-a', id)).toThrow(expect.objectContaining({ statusCode: 409 }))
  })
})

describe('rounds', () => {
  let db: TestDb
  let id: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Runden', includeSelf: false })).id
    for (const name of ['Alice', 'Bob', 'Carla']) {
      addParticipant(db, 'user-a', id, validateParticipantInput({ name }))
    }
    startTournament(db, 'user-a', id)
  })

  it('rejects a new round while the current one is still pending', () => {
    expect(() => createNextRound(db, 'user-a', id))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'round_not_complete' } }))
  })

  it('rejects completing a round with a missing result', () => {
    const detail = getTournamentDetail(db, 'user-a', id)
    const roundId = detail.currentRound!.id
    expect(() => completeRound(db, 'user-a', id, roundId))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'results_missing' } }))
  })

  it('completes round 1 and pairs round 2 by standings', () => {
    let detail = getTournamentDetail(db, 'user-a', id)
    detail = reportBothMatches(db, id, detail)
    detail = completeRound(db, 'user-a', id, detail.rounds[0]!.id)
    expect(detail.rounds[0]!.status).toBe('completed')

    detail = createNextRound(db, 'user-a', id)
    expect(detail.rounds).toHaveLength(2)
    expect(detail.currentRound!.matches.length).toBeGreaterThan(0)

    // Exceeding plannedRounds: complete round 2 and try a third round.
    detail = reportBothMatches(db, id, detail)
    completeRound(db, 'user-a', id, detail.rounds[1]!.id)
    expect(() => createNextRound(db, 'user-a', id))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'planned_rounds_reached' } }))
  })

  it('gives a dropped participant no match in the next round', () => {
    let detail = getTournamentDetail(db, 'user-a', id)
    detail = reportBothMatches(db, id, detail)
    detail = completeRound(db, 'user-a', id, detail.rounds[0]!.id)

    const droppedParticipant = detail.participants[0]!
    updateParticipant(db, 'user-a', id, droppedParticipant.id, { dropped: true })

    detail = createNextRound(db, 'user-a', id)
    const nextRound = detail.rounds[1]!
    const appearsInMatch = nextRound.matches.some(
      match => match.participantAId === droppedParticipant.id || match.participantBId === droppedParticipant.id,
    )
    expect(appearsInMatch).toBe(false)
  })

  it('gives exactly one bye, already reported, for an odd active field', () => {
    const detail = getTournamentDetail(db, 'user-a', id)
    const byes = detail.rounds[0]!.matches.filter(match => match.isBye)
    expect(byes).toHaveLength(1)
    expect(byes[0]!.reported).toBe(true)
    expect(byes[0]!.gamesA).toBe(2)
    expect(byes[0]!.gamesB).toBe(0)
  })
})

describe('match results', () => {
  let db: TestDb
  let id: string
  let detail: TournamentDetail

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Ergebnisse', includeSelf: false })).id
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Alice' }))
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Bob' }))
    detail = startTournament(db, 'user-a', id)
  })

  function firstMatch() {
    return detail.currentRound!.matches[0]!
  }

  it('sets the winner and reportedAt from explicit games', () => {
    detail = reportMatchResult(db, 'user-a', id, firstMatch().id, { gamesA: 2, gamesB: 1 })
    const match = detail.currentRound!.matches[0]!
    expect(match.winnerParticipantId).toBe(match.participantAId)
    expect(match.reported).toBe(true)
    expect(match.reportedAt).toEqual(expect.any(String))
  })

  it('normalizes a winnerParticipantId result to a 2-0', () => {
    const match = firstMatch()
    detail = reportMatchResult(db, 'user-a', id, match.id, { winnerParticipantId: match.participantBId })
    const updated = detail.currentRound!.matches[0]!
    expect(updated.gamesA).toBe(0)
    expect(updated.gamesB).toBe(2)
    expect(updated.winnerParticipantId).toBe(match.participantBId)
  })

  it('normalizes a draw result to 1-1', () => {
    detail = reportMatchResult(db, 'user-a', id, firstMatch().id, { draw: true })
    const match = detail.currentRound!.matches[0]!
    expect(match.gamesA).toBe(1)
    expect(match.gamesB).toBe(1)
    expect(match.isDraw).toBe(true)
    expect(match.winnerParticipantId).toBeNull()
  })

  it('rejects out-of-range games', () => {
    expect(() => reportMatchResult(db, 'user-a', id, firstMatch().id, { gamesA: 20, gamesB: 0 }))
      .toThrow(expect.objectContaining({ statusCode: 400, data: { code: 'invalid_result' } }))
  })

  it('rejects reporting once the round is completed', () => {
    const matchId = firstMatch().id
    detail = reportMatchResult(db, 'user-a', id, matchId, { gamesA: 2, gamesB: 0 })
    detail = completeRound(db, 'user-a', id, detail.rounds[0]!.id)

    expect(() => reportMatchResult(db, 'user-a', id, matchId, { gamesA: 2, gamesB: 0 }))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'round_completed' } }))
  })
})

describe('bye editing', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('rejects reporting a result for a bye', () => {
    const id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Freilos', includeSelf: false })).id
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Alice' }))
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Bob' }))
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Carla' }))
    const detail = startTournament(db, 'user-a', id)
    const bye = detail.currentRound!.matches.find(match => match.isBye)!

    expect(() => reportMatchResult(db, 'user-a', id, bye.id, { gamesA: 2, gamesB: 0 }))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'bye_not_editable' } }))
  })
})

describe('pairing swaps', () => {
  let db: TestDb
  let id: string
  let detail: TournamentDetail

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Tausch', includeSelf: false })).id
    for (const name of ['Alice', 'Bob', 'Carla', 'Dave']) {
      addParticipant(db, 'user-a', id, validateParticipantInput({ name }))
    }
    detail = startTournament(db, 'user-a', id)
  })

  it('reorders both matches before any result is reported', () => {
    const [matchA, matchB] = detail.currentRound!.matches
    const originalB = matchA!.participantBId!
    const originalOtherA = matchB!.participantAId

    detail = swapPairing(db, 'user-a', id, {
      matchAId: matchA!.id,
      slotA: 'b',
      matchBId: matchB!.id,
      slotB: 'a',
    })

    const updatedA = detail.currentRound!.matches.find(match => match.id === matchA!.id)!
    const updatedB = detail.currentRound!.matches.find(match => match.id === matchB!.id)!
    expect(updatedA.participantBId).toBe(originalOtherA)
    expect(updatedB.participantAId).toBe(originalB)
  })

  it('rejects a swap once a result has been reported in the round', () => {
    const [matchA, matchB] = detail.currentRound!.matches
    reportMatchResult(db, 'user-a', id, matchA!.id, { gamesA: 2, gamesB: 0 })

    expect(() => swapPairing(db, 'user-a', id, {
      matchAId: matchA!.id,
      slotA: 'b',
      matchBId: matchB!.id,
      slotB: 'a',
    })).toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'results_reported' } }))
  })
})

describe('pairing swaps — six players', () => {
  let db: TestDb
  let id: string
  let detail: TournamentDetail

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Tausch mit sechs', includeSelf: false })).id
    for (const name of ['Alice', 'Bob', 'Carla', 'Dave', 'Erin', 'Finn']) {
      addParticipant(db, 'user-a', id, validateParticipantInput({ name }))
    }
    detail = startTournament(db, 'user-a', id)
  })

  it('rejects a swap between two unreported tables once a third table in the round has a reported result', () => {
    const [matchA, matchB, matchC] = detail.currentRound!.matches
    expect(detail.currentRound!.matches).toHaveLength(3)

    // Table 3 gets a result; tables 1 and 2 (the ones being swapped) stay
    // untouched. Before this fix, swapPairing only inspected the two matches
    // named in the request, so this swap would have gone through even though
    // results already exist elsewhere in the round.
    reportMatchResult(db, 'user-a', id, matchC!.id, { gamesA: 2, gamesB: 0 })

    expect(() => swapPairing(db, 'user-a', id, {
      matchAId: matchA!.id,
      slotA: 'b',
      matchBId: matchB!.id,
      slotB: 'a',
    })).toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'results_reported' } }))
  })
})

describe('organizer-only enforcement', () => {
  let db: TestDb
  let id: string
  let matchId: string
  let roundId: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Nur Turnierleitung' })).id
    addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' }))
    const started = startTournament(db, 'user-a', id)
    matchId = started.currentRound!.matches[0]!.id
    roundId = started.currentRound!.id
  })

  const operations: Array<{ name: string, run: (db: TestDb, userId: string, id: string) => unknown }> = [
    { name: 'startTournament', run: (db, userId, id) => startTournament(db, userId, id) },
    { name: 'createNextRound', run: (db, userId, id) => createNextRound(db, userId, id) },
    { name: 'reportMatchResult', run: (db, userId, id) => reportMatchResult(db, userId, id, matchId, { gamesA: 2, gamesB: 0 }) },
    { name: 'completeRound', run: (db, userId, id) => completeRound(db, userId, id, roundId) },
    { name: 'finishTournament', run: (db, userId, id) => finishTournament(db, userId, id) },
    { name: 'deleteTournament', run: (db, userId, id) => deleteTournament(db, userId, id) },
  ]

  it.each(operations)('rejects $name from a linked participant with 403 organizer_only', ({ run }) => {
    expect(() => run(db, 'user-b', id))
      .toThrow(expect.objectContaining({ statusCode: 403, data: { code: 'organizer_only' } }))
  })

  it.each(operations)('reports $name as 404 for an outsider, not 403', ({ run }) => {
    expect(() => run(db, 'user-c', id))
      .toThrow(expect.objectContaining({ statusCode: 404 }))
  })
})

describe('finishing a tournament', () => {
  let db: TestDb
  let id: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Abschluss', includeSelf: false })).id
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Alice' }))
    addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Bob' }))
    startTournament(db, 'user-a', id)
  })

  it('rejects finishing with a pending round', () => {
    expect(() => finishTournament(db, 'user-a', id))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'round_not_complete' } }))
  })

  it('finishes once the round is complete, freezing standings, and rejects further mutation', () => {
    let detail = getTournamentDetail(db, 'user-a', id)
    detail = reportBothMatches(db, id, detail)
    completeRound(db, 'user-a', id, detail.rounds[0]!.id)

    detail = finishTournament(db, 'user-a', id)
    expect(detail.status).toBe('finished')
    expect(detail.finishedAt).toEqual(expect.any(String))
    const standingsBefore = JSON.stringify(detail.standings)

    expect(JSON.stringify(getTournamentDetail(db, 'user-a', id).standings)).toBe(standingsBefore)

    expect(() => startTournament(db, 'user-a', id))
      .toThrow(expect.objectContaining({ statusCode: 409 }))
    // A finished tournament reports its own status-specific code, not the
    // registration-phase fallback the call site passes in.
    expect(() => addParticipant(db, 'user-a', id, validateParticipantInput({ name: 'Zu spät' })))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'tournament_finished' } }))
    expect(() => updateTournament(db, 'user-a', id, { name: 'x' }))
      .toThrow(expect.objectContaining({ statusCode: 409, data: { code: 'tournament_finished' } }))
  })

  it('still allows deletion once finished, cascading to participants/rounds/matches', () => {
    let detail = getTournamentDetail(db, 'user-a', id)
    detail = reportBothMatches(db, id, detail)
    completeRound(db, 'user-a', id, detail.rounds[0]!.id)
    finishTournament(db, 'user-a', id)

    deleteTournament(db, 'user-a', id)

    expect(db.select().from(schema.tournamentParticipant).all()).toEqual([])
    expect(db.select().from(schema.tournamentRound).all()).toEqual([])
    expect(db.select().from(schema.tournamentMatch).all()).toEqual([])
  })
})

describe('listing tournaments', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
  })

  it('separates organized tournaments from participations and filters by status', () => {
    const organized = createTournament(db, 'user-a', validateTournamentInput({ name: 'Von A' })).id
    addParticipant(db, 'user-a', organized, validateParticipantInput({ email: 'b@example.com' }))

    const joined = createTournament(db, 'user-b', validateTournamentInput({ name: 'Von B' })).id
    addParticipant(db, 'user-b', joined, validateParticipantInput({ email: 'a@example.com' }))

    const finishedId = createTournament(db, 'user-a', validateTournamentInput({ name: 'Fertig', includeSelf: false })).id
    addParticipant(db, 'user-a', finishedId, validateParticipantInput({ name: 'Alice' }))
    addParticipant(db, 'user-a', finishedId, validateParticipantInput({ name: 'Bob' }))
    let finishedDetail = startTournament(db, 'user-a', finishedId)
    finishedDetail = reportBothMatches(db, finishedId, finishedDetail)
    completeRound(db, 'user-a', finishedId, finishedDetail.rounds[0]!.id)
    finishTournament(db, 'user-a', finishedId)

    const asOrganizer = listTournaments(db, 'user-a', { role: 'organizer' })
    expect(asOrganizer.items.map(item => item.id).sort()).toEqual([organized, finishedId].sort())

    const asParticipant = listTournaments(db, 'user-a', { role: 'participant' })
    expect(asParticipant.items.map(item => item.id)).toEqual([joined])

    const finishedList = listTournaments(db, 'user-a', { status: 'finished' })
    expect(finishedList.items.map(item => item.id)).toEqual([finishedId])
  })

  it('paginates results', () => {
    createTournament(db, 'user-a', validateTournamentInput({ name: 'T1' }))
    createTournament(db, 'user-a', validateTournamentInput({ name: 'T2' }))
    createTournament(db, 'user-a', validateTournamentInput({ name: 'T3' }))

    const page1 = listTournaments(db, 'user-a', { role: 'organizer', page: 1, pageSize: 2 })
    const page2 = listTournaments(db, 'user-a', { role: 'organizer', page: 2, pageSize: 2 })

    expect(page1.total).toBe(3)
    expect(page1.items).toHaveLength(2)
    expect(page2.items).toHaveLength(1)
    expect(new Set([...page1.items, ...page2.items].map(item => item.id)).size).toBe(3)
  })
})

describe('deck snapshot visibility', () => {
  let db: TestDb
  let id: string

  beforeEach(() => {
    db = createTestDb()
    seedUsersAndCatalog(db)
    id = createTournament(db, 'user-a', validateTournamentInput({ name: 'Sichtbarkeit' })).id
    addParticipant(db, 'user-a', id, validateParticipantInput({ email: 'b@example.com' }))

    const deck = buildSmallDeck(db, 'user-a')
    const organizerParticipantId = getTournamentDetail(db, 'user-a', id).participants.find(p => p.isSelf)!.id
    registerParticipantDeck(db, 'user-a', id, organizerParticipantId, deck.id)
  })

  it('hides the snapshot from other participants while running, and reveals it once finished', () => {
    let detail = startTournament(db, 'user-a', id)
    const organizerRow = () => detail.participants.find(p => p.linked && p.name === 'User A')!

    detail = getTournamentDetail(db, 'user-b', id)
    expect(organizerRow().deckSnapshot).toBeNull()

    detail = reportBothMatches(db, id, detail)
    detail = completeRound(db, 'user-a', id, detail.rounds[0]!.id)
    finishTournament(db, 'user-a', id)

    detail = getTournamentDetail(db, 'user-b', id)
    expect(organizerRow().deckSnapshot).not.toBeNull()
  })
})
