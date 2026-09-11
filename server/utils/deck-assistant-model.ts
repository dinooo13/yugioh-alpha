// The AI deck assistant's model abstraction: a small interface the core
// logic (server/utils/deck-assistant.ts) drives, plus two implementations —
// a real Anthropic-backed model and a deterministic, network-free "fake" used
// in tests and whenever no API key is configured for local/dev use.
//
// The server never trusts what a model returns: `generate` hands back
// `unknown`, and every field is defensively validated by the caller.

import Anthropic from '@anthropic-ai/sdk'
import { createError } from 'h3'
import type { AssistantMode, DeckAssistantStatus } from '../../shared/deck-assistant'
import type { DeckSection } from '../../shared/deck-sections'

export type AssistantEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const ASSISTANT_EFFORTS: readonly AssistantEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** One card in the candidate pool the model may pick from — see buildPool in deck-assistant.ts. */
export interface AssistantPoolCard {
  id: number
  name: string
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  linkval: number | null
  atk: number | null
  def: number | null
  archetype: string | null
  owned: number
  maxCopies: number
  extraDeck: boolean
  desc: string
}

/** One card of the caller's current deck, structured for the fake model (improve mode). */
export interface AssistantCurrentDeckCard {
  catalogCardId: number
  name: string
  section: DeckSection
  quantity: number
  owned: number
  maxCopies: number
}

export interface AssistantModelInput {
  mode: AssistantMode
  /** Stable system prompt — must not contain per-request data. */
  system: string
  /**
   * The large, request-stable part of the user turn (format + rules, the
   * current deck in improve mode, and the pool) — deterministically ordered
   * and free of anything that varies between a retry with another play style
   * or notes, so it forms a cacheable prefix across repeat requests.
   */
  context: string
  /** The small, per-request part: mode, play style, and notes. */
  prompt: string
  /** JSON schema for the structured output. */
  schema: Record<string, unknown>
  /** Structured pool, for the fake model (and useful context for a real one). */
  pool: AssistantPoolCard[]
  /** Structured current deck in improve mode; null in build mode. */
  currentDeck: AssistantCurrentDeckCard[] | null
  includeMissing: boolean
}

export interface DeckAssistantModel {
  readonly id: string
  /** Returns the parsed JSON object the model produced — untrusted, unvalidated. */
  generate(input: AssistantModelInput): Promise<unknown>
}

function normalizeEffort(value: unknown): AssistantEffort {
  return typeof value === 'string' && (ASSISTANT_EFFORTS as readonly string[]).includes(value)
    ? value as AssistantEffort
    : 'high'
}

// --- Anthropic-backed model --------------------------------------------------

export interface CreateAnthropicModelOptions {
  apiKey?: string
  model: string
  effort: AssistantEffort
  /** Injectable for tests — an already-constructed (or mocked) SDK client. */
  client?: Anthropic
}

function assistantError(statusCode: number, message: string): never {
  throw createError({ statusCode, statusMessage: message, message })
}

export function createAnthropicModel(options: CreateAnthropicModelOptions): DeckAssistantModel {
  const client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {})
  const model = options.model
  const effort = options.effort

  return {
    id: model,
    async generate(input: AssistantModelInput): Promise<unknown> {
      let response: Anthropic.Beta.BetaMessage
      try {
        // Non-streaming would time out well before a 60-card deck's worth of
        // adaptive thinking + reasons finishes generating at this max_tokens.
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: {
            effort,
            format: { type: 'json_schema', schema: input.schema },
          },
          // No cache_control here: the stable, cacheable prefix is the
          // context block below it, not this short instruction text.
          system: input.system,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: input.context, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: input.prompt },
            ],
          }],
        })
        response = await stream.finalMessage()
      }
      catch (error) {
        if (error instanceof Anthropic.AuthenticationError) {
          assistantError(503, 'KI-Assistent ist nicht korrekt konfiguriert.')
        }
        if (error instanceof Anthropic.RateLimitError) {
          assistantError(503, 'Der KI-Assistent ist ausgelastet, bitte später erneut versuchen.')
        }
        if (error instanceof Anthropic.APIError) {
          assistantError(502, 'Der KI-Assistent ist derzeit nicht erreichbar.')
        }
        throw error
      }

      if (response.stop_reason === 'refusal') {
        assistantError(502, 'Der Assistent hat die Anfrage abgelehnt.')
      }
      if (response.stop_reason === 'max_tokens') {
        assistantError(502, 'Die Antwort des Assistenten war zu lang oder unvollständig.')
      }

      // With `fallbacks: 'default'`, a mid-stream refusal can leave the
      // declined model's partial text ahead of a `fallback` block, followed
      // by the fallback model's complete answer — the answer we want is
      // always the LAST text block, never the first.
      const textBlock = response.content.findLast(
        (block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text',
      )
      if (!textBlock) {
        assistantError(502, 'Ungültige Antwort des Assistenten.')
      }

      try {
        return JSON.parse(textBlock.text)
      }
      catch {
        assistantError(502, 'Ungültige Antwort des Assistenten.')
      }
    },
  }
}

// --- Fake model (deterministic, no network) ----------------------------------

const FAKE_MODEL_ID = 'fake'
const FAKE_MAIN_LIMIT = 40
const FAKE_EXTRA_LIMIT = 15
const FAKE_STAPLES = ['Pot of Greed', 'Raigeki', 'Monster Reborn', 'Mirror Force']

interface FakeCardOutput { id: number, section: DeckSection, quantity: number, reason: string }
interface FakeMissingOutput { name: string, section: DeckSection, quantity: number, reason: string }
interface FakeChangeOutput { action: 'add' | 'remove', id: number, section: DeckSection, quantity: number, reason: string }

function fakeMissingSuggestions(pool: AssistantPoolCard[], includeMissing: boolean): FakeMissingOutput[] {
  if (!includeMissing) {
    return []
  }
  const owned = new Set(pool.map(card => card.name.toLowerCase()))
  return FAKE_STAPLES
    .filter(name => !owned.has(name.toLowerCase()))
    .map(name => ({ name, section: 'main' as DeckSection, quantity: 1, reason: 'Testvorschlag (fehlt)' }))
}

function buildFakeBuildOutput(pool: AssistantPoolCard[], includeMissing: boolean) {
  const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name))
  const mainCards = sorted.filter(card => !card.extraDeck).slice(0, FAKE_MAIN_LIMIT)
  const extraCards = sorted.filter(card => card.extraDeck).slice(0, FAKE_EXTRA_LIMIT)

  const cards: FakeCardOutput[] = [...mainCards, ...extraCards].map(card => ({
    id: card.id,
    section: card.extraDeck ? 'extra' : 'main',
    quantity: Math.max(1, Math.min(card.maxCopies, card.owned)),
    reason: 'Testvorschlag',
  }))

  return {
    summary: 'Testvorschlag des deterministischen Assistenten (Fake-Modell).',
    cards,
    missing: fakeMissingSuggestions(pool, includeMissing),
  }
}

function buildFakeImproveOutput(
  pool: AssistantPoolCard[],
  currentDeck: AssistantCurrentDeckCard[],
  includeMissing: boolean,
) {
  const changes: FakeChangeOutput[] = []

  const quantityByCard = new Map<number, number>()
  for (const entry of currentDeck) {
    quantityByCard.set(entry.catalogCardId, (quantityByCard.get(entry.catalogCardId) ?? 0) + entry.quantity)
  }

  const sortedPool = [...pool].sort((a, b) => a.name.localeCompare(b.name))
  const addCandidate = sortedPool.find((card) => {
    const cap = Math.min(card.maxCopies, card.owned)
    return (quantityByCard.get(card.id) ?? 0) < cap
  })
  if (addCandidate) {
    changes.push({
      action: 'add',
      id: addCandidate.id,
      section: addCandidate.extraDeck ? 'extra' : 'main',
      quantity: 1,
      reason: 'Testvorschlag: Karte hinzufügen',
    })
  }

  const mainCards = currentDeck.filter(entry => entry.section === 'main' && entry.quantity > 0)
  const sortedMain = [...mainCards].sort((a, b) => a.name.localeCompare(b.name))
  const removeCandidate = sortedMain.at(-1)
  if (removeCandidate) {
    changes.push({
      action: 'remove',
      id: removeCandidate.catalogCardId,
      section: 'main',
      quantity: 1,
      reason: 'Testvorschlag: Karte entfernen',
    })
  }

  return {
    summary: 'Testvorschlag des deterministischen Assistenten (Fake-Modell).',
    changes,
    missing: fakeMissingSuggestions(pool, includeMissing),
  }
}

export function createFakeModel(): DeckAssistantModel {
  return {
    id: FAKE_MODEL_ID,
    async generate(input: AssistantModelInput): Promise<unknown> {
      if (input.mode === 'build') {
        return buildFakeBuildOutput(input.pool, input.includeMissing)
      }
      return buildFakeImproveOutput(input.pool, input.currentDeck ?? [], input.includeMissing)
    },
  }
}

// --- Configuration resolution -------------------------------------------------

export interface DeckAssistantRuntimeConfig {
  provider: string
  apiKey: string
  model: string
  effort: string
}

type Provider = 'anthropic' | 'fake' | null

function resolveProvider(config: DeckAssistantRuntimeConfig): Provider {
  const raw = (config.provider ?? '').trim().toLowerCase()
  if (raw === 'fake') {
    return 'fake'
  }
  if (raw === 'anthropic') {
    return 'anthropic'
  }
  if (raw === '' && ((config.apiKey ?? '').trim() !== '' || Boolean(process.env.ANTHROPIC_API_KEY))) {
    return 'anthropic'
  }
  return null
}

function resolveModelId(config: DeckAssistantRuntimeConfig): string {
  const trimmed = (config.model ?? '').trim()
  return trimmed !== '' ? trimmed : 'claude-opus-5'
}

export function useDeckAssistantModel(): DeckAssistantModel | null {
  const config = useRuntimeConfig().assistant as DeckAssistantRuntimeConfig
  const provider = resolveProvider(config)

  if (provider === 'fake') {
    return createFakeModel()
  }
  if (provider === 'anthropic') {
    const apiKey = (config.apiKey ?? '').trim()
    return createAnthropicModel({
      model: resolveModelId(config),
      effort: normalizeEffort(config.effort),
      ...(apiKey !== '' ? { apiKey } : {}),
    })
  }
  return null
}

export function getDeckAssistantStatus(): DeckAssistantStatus {
  const config = useRuntimeConfig().assistant as DeckAssistantRuntimeConfig
  const provider = resolveProvider(config)

  if (provider === 'fake') {
    return { enabled: true, provider: 'fake', model: FAKE_MODEL_ID }
  }
  if (provider === 'anthropic') {
    return { enabled: true, provider: 'anthropic', model: resolveModelId(config) }
  }
  return { enabled: false, provider: null, model: null }
}
