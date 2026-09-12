// Pure standings computation. Match points + the four standard tiebreakers.

export interface StandingsParticipant {
  id: string
  seed: number
  dropped: boolean
}

export interface StandingsMatch {
  participantAId: string
  /** null = bye for A. */
  participantBId: string | null
  winnerParticipantId: string | null
  gamesA: number
  gamesB: number
  isDraw: boolean
  /** Unreported matches are ignored entirely. */
  reported: boolean
}

export interface StandingsRow {
  participantId: string
  /** 1-based, dense, no shared ranks (the seed tiebreak makes the order total). */
  rank: number
  matchesPlayed: number
  wins: number
  losses: number
  draws: number
  byes: number
  points: number
  gamesWon: number
  gamesLost: number
  /** Own match-win percentage, floored at 1/3. 0..1, rounded to 4 decimals. */
  matchWinRate: number
  /** Own game-win percentage, floored at 1/3. */
  gameWinRate: number
  /** Opponents' match-win percentage (OMW%). */
  opponentMatchWinRate: number
  /** Opponents' game-win percentage (OGW%). */
  opponentGameWinRate: number
  dropped: boolean
}

// Canonical home for the scoring constants; `shared/tournaments.ts` re-exports
// these rather than redeclaring them, so the pairing/round-creation path and
// the standings path can never drift apart.
export const POINTS_WIN = 3
export const POINTS_DRAW = 1

/** Floor applied to every *own* win rate before it is averaged into an opponent rate. */
export const MIN_WIN_RATE = 1 / 3

/** A bye is scored as a 2–0 win (3 match points). */
export const BYE_GAMES = 2

interface Accumulator {
  matchesPlayed: number
  wins: number
  losses: number
  draws: number
  byes: number
  points: number
  gamesWon: number
  gamesLost: number
  opponentIds: string[]
}

function newAccumulator(): Accumulator {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    byes: 0,
    points: 0,
    gamesWon: 0,
    gamesLost: 0,
    opponentIds: [],
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export function computeStandings(
  participants: StandingsParticipant[],
  matches: StandingsMatch[],
): StandingsRow[] {
  const knownIds = new Set(participants.map(p => p.id))
  const acc = new Map<string, Accumulator>()
  for (const participant of participants) {
    acc.set(participant.id, newAccumulator())
  }

  for (const match of matches) {
    if (!match.reported) {
      continue
    }
    if (!knownIds.has(match.participantAId)) {
      continue
    }

    const a = acc.get(match.participantAId)!

    if (match.participantBId === null) {
      a.wins += 1
      a.byes += 1
      a.matchesPlayed += 1
      a.points += POINTS_WIN
      a.gamesWon += BYE_GAMES
      continue
    }

    if (!knownIds.has(match.participantBId)) {
      continue
    }
    const b = acc.get(match.participantBId)!

    a.matchesPlayed += 1
    b.matchesPlayed += 1
    a.gamesWon += match.gamesA
    a.gamesLost += match.gamesB
    b.gamesWon += match.gamesB
    b.gamesLost += match.gamesA
    a.opponentIds.push(match.participantBId)
    b.opponentIds.push(match.participantAId)

    if (match.isDraw) {
      a.draws += 1
      b.draws += 1
      a.points += POINTS_DRAW
      b.points += POINTS_DRAW
    }
    else if (match.winnerParticipantId === match.participantAId) {
      a.wins += 1
      b.losses += 1
      a.points += POINTS_WIN
    }
    else if (match.winnerParticipantId === match.participantBId) {
      b.wins += 1
      a.losses += 1
      b.points += POINTS_WIN
    }
    else {
      // Defensive: no winner and not a draw — treat as a double loss (no points).
      a.losses += 1
      b.losses += 1
    }
  }

  // Own rates, floored at MIN_WIN_RATE (see StandingsRow.matchWinRate):
  // computed unrounded here, rounded once at the very end (step 5).
  const flooredMatchWinRate = new Map<string, number>()
  const flooredGameWinRate = new Map<string, number>()

  for (const participant of participants) {
    const a = acc.get(participant.id)!
    const totalGames = a.gamesWon + a.gamesLost

    const rawMwr = a.matchesPlayed === 0 ? 0 : a.points / (POINTS_WIN * a.matchesPlayed)
    const rawGwr = totalGames === 0 ? 0 : a.gamesWon / totalGames

    flooredMatchWinRate.set(participant.id, a.matchesPlayed > 0 ? Math.max(rawMwr, MIN_WIN_RATE) : 0)
    flooredGameWinRate.set(participant.id, totalGames > 0 ? Math.max(rawGwr, MIN_WIN_RATE) : 0)
  }

  const rows: StandingsRow[] = participants.map((participant) => {
    const a = acc.get(participant.id)!

    const opponentMwr = a.opponentIds.length === 0
      ? 0
      : a.opponentIds.reduce((sum, id) => sum + (flooredMatchWinRate.get(id) ?? 0), 0) / a.opponentIds.length
    const opponentGwr = a.opponentIds.length === 0
      ? 0
      : a.opponentIds.reduce((sum, id) => sum + (flooredGameWinRate.get(id) ?? 0), 0) / a.opponentIds.length

    return {
      participantId: participant.id,
      rank: 0,
      matchesPlayed: a.matchesPlayed,
      wins: a.wins,
      losses: a.losses,
      draws: a.draws,
      byes: a.byes,
      points: a.points,
      gamesWon: a.gamesWon,
      gamesLost: a.gamesLost,
      matchWinRate: round4(flooredMatchWinRate.get(participant.id) ?? 0),
      gameWinRate: round4(flooredGameWinRate.get(participant.id) ?? 0),
      opponentMatchWinRate: round4(opponentMwr),
      opponentGameWinRate: round4(opponentGwr),
      dropped: participant.dropped,
    }
  })

  const seedById = new Map(participants.map(p => [p.id, p.seed]))

  rows.sort((x, y) => {
    if (y.points !== x.points) {
      return y.points - x.points
    }
    if (y.opponentMatchWinRate !== x.opponentMatchWinRate) {
      return y.opponentMatchWinRate - x.opponentMatchWinRate
    }
    if (y.gameWinRate !== x.gameWinRate) {
      return y.gameWinRate - x.gameWinRate
    }
    if (y.opponentGameWinRate !== x.opponentGameWinRate) {
      return y.opponentGameWinRate - x.opponentGameWinRate
    }
    return (seedById.get(x.participantId) ?? 0) - (seedById.get(y.participantId) ?? 0)
  })

  rows.forEach((row, index) => {
    row.rank = index + 1
  })

  return rows
}
