// Types, German labels, and limits shared by the server (server/utils/tournaments.ts)
// and the tournament UI (app/pages/turniere/**). Intentionally dependency-free.

import type { StandingsRow } from './tournament-standings'

// Scoring constants live in tournament-standings.ts (the standings path);
// re-exported here so the pairing/round-creation path (server/utils/tournaments.ts)
// uses the same values instead of a second, independently-maintained copy.
export { BYE_GAMES, POINTS_DRAW, POINTS_WIN } from './tournament-standings'

// --- Enums + labels --------------------------------------------------------

export const TOURNAMENT_STATUSES = ['registration', 'running', 'finished'] as const
export type TournamentStatus = typeof TOURNAMENT_STATUSES[number]

export const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  registration: 'Anmeldung',
  running: 'Läuft',
  finished: 'Abgeschlossen',
}

export const PAIRING_SYSTEMS = ['swiss', 'round_robin'] as const
export type PairingSystem = typeof PAIRING_SYSTEMS[number]

export const PAIRING_SYSTEM_LABELS: Record<PairingSystem, string> = {
  swiss: 'Schweizer System',
  round_robin: 'Jeder gegen jeden',
}

export const PAIRING_SYSTEM_DESCRIPTIONS: Record<PairingSystem, string> = {
  swiss: 'Gleich starke Spieler treffen aufeinander; Wiederholungen werden vermieden.',
  round_robin: 'Jeder Spieler tritt genau einmal gegen jeden anderen an.',
}

export const ROUND_STATUSES = ['pending', 'completed'] as const
export type RoundStatus = typeof ROUND_STATUSES[number]

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  pending: 'Offen',
  completed: 'Abgeschlossen',
}

export type TournamentRole = 'organizer' | 'participant'

// --- Constants -------------------------------------------------------------

export const TOURNAMENT_NAME_MAX_LENGTH = 80
export const TOURNAMENT_DESCRIPTION_MAX_LENGTH = 500
export const PARTICIPANT_NAME_MAX_LENGTH = 60
export const MIN_PARTICIPANTS_TO_START = 2
export const MAX_PARTICIPANTS = 64
/**
 * Highest round robin (an even, `MAX_PARTICIPANTS`-sized field) needs
 * `MAX_PARTICIPANTS - 1` rounds; keep the manual Swiss cap in sync with it so
 * `plannedRounds` always fits regardless of pairing system (see D-round-robin
 * cap in the tournament review).
 */
export const MAX_PLANNED_ROUNDS = MAX_PARTICIPANTS - 1
/** Sanity cap per side of a match result (best-of-3 … best-of-9). */
export const MAX_GAMES_PER_MATCH = 9
/** Games recorded for the winner when a result is entered as a plain win. */
export const DEFAULT_WIN_GAMES = 2
/** Games recorded for both sides when a result is entered as a plain draw. */
export const DEFAULT_DRAW_GAMES = 1
export const POINTS_LOSS = 0
/** Deck snapshot keeps at most this many rule-violation messages. */
export const MAX_SNAPSHOT_ISSUES = 10

// --- Deck snapshot ---------------------------------------------------------

export interface TournamentDeckSnapshotCard {
  catalogCardId: number
  name: string
  quantity: number
}

export interface TournamentDeckSnapshot {
  /** The deck this was copied from. It may have been edited or deleted since. */
  deckId: string
  name: string
  /** Name of the tournament format the snapshot was checked against, if any. */
  formatName?: string
  sections: {
    main: TournamentDeckSnapshotCard[]
    extra: TournamentDeckSnapshotCard[]
    side: TournamentDeckSnapshotCard[]
  }
  counts: { main: number, extra: number, side: number, total: number }
  /** Frozen verdict; null when the tournament has no format. */
  validation: { legal: boolean, issueCount: number, issues: string[] } | null
  /** ISO 8601 instant the snapshot was taken. */
  capturedAt: string
}

// --- Response DTOs (ISO string dates — see D10) ----------------------------

export interface TournamentFormatRef {
  id: string
  name: string
  isBuiltin: boolean
}

export interface TournamentParticipantDto {
  id: string
  name: string
  /** True when the row is linked to an app user (never exposes who). */
  linked: boolean
  /** True when the row is the calling user. */
  isSelf: boolean
  dropped: boolean
  seed: number
  deckId: string | null
  deckName: string | null
  deckLegal: boolean | null
  deckIssueCount: number | null
  /**
   * Full decklist. Visible to the organizer, to the owner of the row, and to
   * everyone once the tournament is finished; otherwise null.
   */
  deckSnapshot: TournamentDeckSnapshot | null
  createdAt: string
}

export interface TournamentMatchDto {
  id: string
  roundId: string
  roundNumber: number
  tableNumber: number
  participantAId: string
  participantAName: string
  /** null = bye. */
  participantBId: string | null
  participantBName: string | null
  winnerParticipantId: string | null
  gamesA: number
  gamesB: number
  isDraw: boolean
  isBye: boolean
  reported: boolean
  reportedAt: string | null
}

export interface TournamentRoundDto {
  id: string
  number: number
  status: RoundStatus
  matches: TournamentMatchDto[]
  createdAt: string
  completedAt: string | null
}

export interface TournamentStandingRow extends StandingsRow {
  name: string
}

export interface TournamentListItem {
  id: string
  name: string
  description: string | null
  status: TournamentStatus
  pairingSystem: PairingSystem
  format: TournamentFormatRef | null
  organizerName: string
  role: TournamentRole
  participantCount: number
  roundCount: number
  plannedRounds: number | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export interface TournamentListResponse {
  items: TournamentListItem[]
  total: number
  page: number
  pageSize: number
}

export interface TournamentDetail {
  id: string
  name: string
  description: string | null
  status: TournamentStatus
  pairingSystem: PairingSystem
  plannedRounds: number | null
  format: TournamentFormatRef | null
  organizerName: string
  role: TournamentRole
  /** The caller's own participant row, when they play in the tournament. */
  selfParticipantId: string | null
  participants: TournamentParticipantDto[]
  rounds: TournamentRoundDto[]
  /** The last round when it is still pending, else null. */
  currentRound: TournamentRoundDto | null
  standings: TournamentStandingRow[]
  /** Server-computed action gates so the UI never re-derives the state machine. */
  canStart: boolean
  canCreateRound: boolean
  canCompleteRound: boolean
  canFinish: boolean
  canEditPairings: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

// --- Error codes -----------------------------------------------------------

export const TOURNAMENT_ERROR_CODES = [
  'invalid_body', 'invalid_name', 'invalid_description', 'invalid_pairing_system',
  'invalid_planned_rounds', 'unknown_format', 'invalid_participant', 'user_not_found',
  'unknown_deck', 'empty_deck', 'invalid_result', 'invalid_swap',
  'organizer_only', 'foreign_deck_owner',
  'not_enough_participants', 'too_many_participants', 'participant_exists',
  'registration_closed', 'tournament_started', 'tournament_finished', 'invalid_status',
  'round_not_complete', 'round_completed', 'results_missing', 'results_reported',
  'planned_rounds_reached', 'bye_not_editable', 'no_rounds',
] as const
export type TournamentErrorCode = typeof TOURNAMENT_ERROR_CODES[number]

/** German messages for the codes the API returns in `data.code`. */
export const TOURNAMENT_ERROR_MESSAGES: Record<TournamentErrorCode, string> = {
  invalid_body: 'Die Anfrage konnte nicht gelesen werden.',
  invalid_name: `Der Name ist erforderlich und darf höchstens ${TOURNAMENT_NAME_MAX_LENGTH} Zeichen lang sein.`,
  invalid_description: `Die Beschreibung darf höchstens ${TOURNAMENT_DESCRIPTION_MAX_LENGTH} Zeichen lang sein.`,
  invalid_pairing_system: 'Unbekanntes Paarungssystem.',
  invalid_planned_rounds: `Die Rundenzahl muss zwischen 1 und ${MAX_PLANNED_ROUNDS} liegen.`,
  unknown_format: 'Dieses Format gibt es nicht.',
  invalid_participant: 'Gib entweder eine E-Mail-Adresse oder einen Namen an.',
  user_not_found: 'Zu dieser E-Mail-Adresse gibt es kein Konto.',
  unknown_deck: 'Dieses Deck gibt es nicht.',
  empty_deck: 'Ein leeres Deck kann nicht angemeldet werden.',
  invalid_result: 'Das Ergebnis ist ungültig.',
  invalid_swap: 'Diese Paarungen können nicht getauscht werden.',
  organizer_only: 'Das kann nur die Turnierleitung.',
  foreign_deck_owner: 'Dieser Spieler meldet sein Deck selbst an.',
  not_enough_participants: `Mindestens ${MIN_PARTICIPANTS_TO_START} Teilnehmer sind nötig.`,
  too_many_participants: `Ein Turnier fasst höchstens ${MAX_PARTICIPANTS} Teilnehmer.`,
  participant_exists: 'Dieser Teilnehmer ist schon dabei.',
  registration_closed: 'Die Anmeldung ist geschlossen.',
  tournament_started: 'Das Turnier läuft bereits.',
  tournament_finished: 'Das Turnier ist abgeschlossen.',
  invalid_status: 'In diesem Turnierstatus ist das nicht möglich.',
  round_not_complete: 'Die laufende Runde ist noch nicht abgeschlossen.',
  round_completed: 'Diese Runde ist bereits abgeschlossen.',
  results_missing: 'Es fehlen noch Ergebnisse in dieser Runde.',
  results_reported: 'In dieser Runde wurden bereits Ergebnisse eingetragen.',
  planned_rounds_reached: 'Alle geplanten Runden wurden gespielt.',
  bye_not_editable: 'Ein Freilos hat kein Ergebnis.',
  no_rounds: 'Es wurde noch keine Runde gespielt.',
}

// --- Small helpers ---------------------------------------------------------

/** Swiss default: ceil(log2(n)), at least 1. 2→1, 4→2, 8→3, 16→4, 64→6. */
export function swissRoundCount(participantCount: number): number {
  if (participantCount < 2) {
    return 1
  }
  return Math.max(1, Math.ceil(Math.log2(participantCount)))
}

/** Round robin: n-1 rounds for an even field, n for an odd one (one bye each round). */
export function roundRobinRoundCount(participantCount: number): number {
  if (participantCount < 2) {
    return 0
  }
  return participantCount % 2 === 0 ? participantCount - 1 : participantCount
}

export function defaultPlannedRounds(system: PairingSystem, participantCount: number): number {
  return system === 'round_robin'
    ? roundRobinRoundCount(participantCount)
    : swissRoundCount(participantCount)
}

/** "0,6667" → "66,7 %" for standings tiebreakers. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1).replace('.', ',')} %`
}
