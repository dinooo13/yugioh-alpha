import { describe, expect, it } from 'vitest'
import { computeStandings } from '../../shared/tournament-standings'
import type { StandingsMatch, StandingsParticipant } from '../../shared/tournament-standings'

function participant(id: string, seed: number, dropped = false): StandingsParticipant {
  return { id, seed, dropped }
}

describe('computeStandings', () => {
  it('ranks a 4-player, 2-round field by points then the standard tiebreakers', () => {
    const participants = [
      participant('p1', 1),
      participant('p2', 2),
      participant('p3', 3),
      participant('p4', 4),
    ]
    const matches: StandingsMatch[] = [
      { participantAId: 'p1', participantBId: 'p2', winnerParticipantId: 'p1', gamesA: 2, gamesB: 0, isDraw: false, reported: true },
      { participantAId: 'p3', participantBId: 'p4', winnerParticipantId: 'p3', gamesA: 2, gamesB: 1, isDraw: false, reported: true },
      { participantAId: 'p1', participantBId: 'p3', winnerParticipantId: 'p1', gamesA: 2, gamesB: 1, isDraw: false, reported: true },
      { participantAId: 'p2', participantBId: 'p4', winnerParticipantId: null, gamesA: 1, gamesB: 1, isDraw: true, reported: true },
    ]

    const rows = computeStandings(participants, matches)
    const byId = Object.fromEntries(rows.map(row => [row.participantId, row]))

    expect(rows.map(row => row.participantId)).toEqual(['p1', 'p3', 'p2', 'p4'])

    expect(byId.p1).toMatchObject({
      rank: 1, points: 6, wins: 2, losses: 0, draws: 0,
      gamesWon: 4, gamesLost: 1,
      gameWinRate: 0.8, matchWinRate: 1,
      opponentMatchWinRate: 0.4167, opponentGameWinRate: 0.4167,
    })
    expect(byId.p3).toMatchObject({
      rank: 2, points: 3, wins: 1, losses: 1, draws: 0,
      gamesWon: 3, gamesLost: 3,
      gameWinRate: 0.5, matchWinRate: 0.5,
      opponentMatchWinRate: 0.6667, opponentGameWinRate: 0.6,
    })
    expect(byId.p2).toMatchObject({
      rank: 3, points: 1, wins: 0, losses: 1, draws: 1,
      gamesWon: 1, gamesLost: 3,
      gameWinRate: 0.3333, matchWinRate: 0.3333,
      opponentMatchWinRate: 0.6667, opponentGameWinRate: 0.6,
    })
    expect(byId.p4).toMatchObject({
      rank: 4, points: 1, wins: 0, losses: 1, draws: 1,
      gamesWon: 2, gamesLost: 3,
      gameWinRate: 0.4, matchWinRate: 0.3333,
      opponentMatchWinRate: 0.4167, opponentGameWinRate: 0.4167,
    })
  })

  it('scores a bye as a 2-0 win that contributes no opponent', () => {
    const participants = [participant('p1', 1), participant('p2', 2), participant('p3', 3)]
    const matches: StandingsMatch[] = [
      { participantAId: 'p1', participantBId: 'p2', winnerParticipantId: 'p1', gamesA: 2, gamesB: 0, isDraw: false, reported: true },
      { participantAId: 'p3', participantBId: null, winnerParticipantId: 'p3', gamesA: 2, gamesB: 0, isDraw: false, reported: true },
    ]

    const rows = computeStandings(participants, matches)
    const byId = Object.fromEntries(rows.map(row => [row.participantId, row]))

    expect(byId.p1!.points).toBe(3)
    expect(byId.p3!.points).toBe(3)
    expect(byId.p3!.byes).toBe(1)
    expect(byId.p3!.wins).toBe(1)
    expect(byId.p3!.gameWinRate).toBe(1)
    expect(byId.p3!.opponentMatchWinRate).toBe(0)
    expect(byId.p1!.opponentMatchWinRate).toBe(0.3333)

    expect(rows.map(row => row.participantId)).toEqual(['p1', 'p3', 'p2'])
  })

  it('ignores unreported matches, keeps dropped participants, and skips unknown ids', () => {
    const participants = [participant('p1', 1), participant('p2', 2, true)]
    const matches: StandingsMatch[] = [
      { participantAId: 'p1', participantBId: 'p2', winnerParticipantId: 'p1', gamesA: 2, gamesB: 0, isDraw: false, reported: false },
      { participantAId: 'p1', participantBId: 'unknown', winnerParticipantId: 'p1', gamesA: 2, gamesB: 0, isDraw: false, reported: true },
    ]

    const rows = computeStandings(participants, matches)
    for (const row of rows) {
      expect(row.matchesPlayed).toBe(0)
      expect(row.points).toBe(0)
      expect(row.matchWinRate).toBe(0)
      expect(row.gameWinRate).toBe(0)
      expect(row.opponentMatchWinRate).toBe(0)
      expect(row.opponentGameWinRate).toBe(0)
    }
    expect(rows.map(row => row.participantId)).toEqual(['p1', 'p2'])
    expect(rows.find(row => row.participantId === 'p2')!.dropped).toBe(true)
  })

  it('returns an empty table for no participants', () => {
    expect(computeStandings([], [])).toEqual([])
  })
})
