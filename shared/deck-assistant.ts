// Shared contract for the AI deck assistant (Phase 5), used by both the
// server (server/utils/deck-assistant*.ts, server/api/assistant/**) and the
// UI. Intentionally dependency-free beyond the other pure shared modules, so
// the UI can import types without pulling in server code.

import type { DeckSection } from './deck-sections'
import type { DeckValidation } from './rule-formats'

export const PLAY_STYLES = [
  {
    id: 'balanced',
    label: 'Ausgewogen',
    description: 'Eine ausgewogene Mischung aus Angriff, Abwehr und Konsistenz.',
  },
  {
    id: 'aggro',
    label: 'Aggro / Beatdown',
    description: 'Schneller Schaden und aggressiver Druck ab der ersten Runde.',
  },
  {
    id: 'control',
    label: 'Kontrolle',
    description: 'Den Gegner mit Fallen und Entfernungseffekten unter Kontrolle halten.',
  },
  {
    id: 'combo',
    label: 'Combo',
    description: 'Kartenkombinationen, die starke Field-Presence oder Wins aufbauen.',
  },
  {
    id: 'stall',
    label: 'Stall / Burn',
    description: 'Das Spiel verzögern und den Gegner über Effektschaden auslaugen.',
  },
  {
    id: 'archetype',
    label: 'Archetyp-Fokus',
    description: 'Konsequent auf die Synergien eines einzelnen Archetyps setzen.',
  },
] as const

export type PlayStyleId = typeof PLAY_STYLES[number]['id']

export type AssistantMode = 'build' | 'improve'

export const ASSISTANT_NOTES_MAX = 500

export interface DeckAssistantRequest {
  mode: AssistantMode
  /** Required when mode === 'improve'. */
  deckId?: string
  /**
   * build: the format to respect (null = no format).
   * improve: undefined -> use the deck's own format; an explicit value overrides it.
   */
  formatId?: string | null
  playStyle: PlayStyleId
  /** Optional free text, at most ASSISTANT_NOTES_MAX characters. */
  notes?: string
  /** Whether cards the user does not (fully) own may be suggested. Defaults to true. */
  includeMissing?: boolean
}

export interface AssistantDeckEntry {
  catalogCardId: number
  name: string
  section: DeckSection
  quantity: number
  owned: number
  reason: string
}

export interface AssistantChange {
  action: 'add' | 'remove'
  catalogCardId: number
  name: string
  section: DeckSection
  quantity: number
  owned: number
  reason: string
}

export interface AssistantMissingCard {
  catalogCardId: number
  name: string
  section: DeckSection
  quantity: number
  owned: number
  reason: string
}

export interface DeckAssistantResult {
  mode: AssistantMode
  formatId: string | null
  formatName: string | null
  playStyle: PlayStyleId
  summary: string
  /** build only; null in improve mode. */
  deck: Record<DeckSection, AssistantDeckEntry[]> | null
  /** improve only; [] in build mode. */
  changes: AssistantChange[]
  /** Cards not (sufficiently) owned — always kept separate from owned suggestions. */
  missing: AssistantMissingCard[]
  /**
   * build: validation of the proposed deck.
   * improve: validation of the current deck with every `changes` entry applied.
   * null when no format is in play.
   */
  validation: DeckValidation | null
  /** German, e.g. dropped suggestions, pool truncated. */
  warnings: string[]
  /** The model id that produced this result, or 'fake' for the deterministic stub. */
  model: string
}

export interface DeckAssistantStatus {
  enabled: boolean
  provider: 'anthropic' | 'fake' | null
  model: string | null
}

export function isPlayStyleId(value: unknown): value is PlayStyleId {
  return typeof value === 'string' && (PLAY_STYLES as readonly { id: string }[]).some(style => style.id === value)
}
