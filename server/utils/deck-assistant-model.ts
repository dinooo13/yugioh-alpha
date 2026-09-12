// The AI deck assistant's model abstraction: a small interface the core
// logic (server/utils/deck-assistant.ts) drives, plus two implementations —
// a real model reached over any OpenAI-compatible Chat Completions endpoint,
// and a deterministic, network-free "fake" used in tests and whenever no
// provider is configured for local/dev use.
//
// The server never trusts what a model returns: `generate` hands back
// `unknown`, and every field is defensively validated by the caller.

import { createError } from 'h3'
import type { AssistantMode, DeckAssistantStatus } from '../../shared/deck-assistant'
import type { DeckSection } from '../../shared/deck-sections'

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

function assistantError(statusCode: number, message: string): never {
  throw createError({ statusCode, statusMessage: message, message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// --- OpenAI-compatible model --------------------------------------------------
//
// Talks to any Chat Completions endpoint that follows the OpenAI schema —
// OpenAI itself, OpenRouter, Ollama, LM Studio, OpenCode Zen, etc. — over
// plain `fetch`, non-streaming, with a 120s timeout. Structured output is
// requested via `response_format: { type: 'json_schema', ... }`; servers
// that don't support it answer with 400/422, in which case we fall back to
// `json_object` mode (schema appended to the system prompt as an
// instruction), and finally to no `response_format` at all.

const REQUEST_TIMEOUT_MS = 120_000

export interface CreateOpenAiCompatibleModelOptions {
  baseUrl: string
  apiKey?: string
  model: string
  /** Injectable for tests. */
  fetch?: typeof fetch
}

type ChatCompletionOutcome =
  | { kind: 'response', status: number, json: unknown }
  | { kind: 'timeout' }
  | { kind: 'network-error' }

async function postChatCompletion(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<ChatCompletionOutcome> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey !== '' ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    let json: unknown = null
    try {
      json = await response.json()
    }
    catch {
      json = null
    }
    return { kind: 'response', status: response.status, json }
  }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { kind: 'timeout' }
    }
    return { kind: 'network-error' }
  }
  finally {
    clearTimeout(timeoutId)
  }
}

function extractMessageText(message: unknown): string {
  if (!isRecord(message)) {
    return ''
  }
  const content = message.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string, text: string } =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('')
  }
  return ''
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1] ?? trimmed
}

function parseChatCompletionBody(json: unknown): unknown {
  if (!isRecord(json)) {
    assistantError(502, 'Ungültige Antwort des Assistenten.')
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
  if (!isRecord(choice)) {
    assistantError(502, 'Ungültige Antwort des Assistenten.')
  }

  if (choice.finish_reason === 'length') {
    assistantError(502, 'Die Antwort des Assistenten war zu lang oder unvollständig.')
  }
  if (choice.finish_reason === 'content_filter') {
    assistantError(502, 'Der Assistent hat die Anfrage abgelehnt.')
  }

  const text = stripCodeFences(extractMessageText(choice.message))
  try {
    return JSON.parse(text)
  }
  catch {
    assistantError(502, 'Ungültige Antwort des Assistenten.')
  }
}

/** Whether a response_format the server rejected should be retried in a more compatible mode. */
function isUnsupportedResponseFormat(status: number): boolean {
  return status === 400 || status === 422
}

export function createOpenAiCompatibleModel(options: CreateOpenAiCompatibleModelOptions): DeckAssistantModel {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const apiKey = options.apiKey ?? ''
  const model = options.model
  const fetchImpl = options.fetch ?? fetch

  return {
    id: model,
    async generate(input: AssistantModelInput): Promise<unknown> {
      const userContent = `${input.context}\n\n${input.prompt}`

      // Three attempts, most-structured first: json_schema, then json_object
      // (with the schema folded into the system prompt), then no
      // response_format at all — each only tried when the previous one was
      // rejected as unsupported (400/422), never on any other failure.
      const attempts: Array<{ system: string, responseFormat: Record<string, unknown> | null }> = [
        {
          system: input.system,
          responseFormat: { type: 'json_schema', json_schema: { name: 'deck_assistant', schema: input.schema } },
        },
        {
          system: `${input.system}\n\nAntworte ausschließlich mit einem JSON-Objekt nach diesem Schema: ${JSON.stringify(input.schema)}`,
          responseFormat: { type: 'json_object' },
        },
        {
          system: input.system,
          responseFormat: null,
        },
      ]

      for (const [i, attempt] of attempts.entries()) {
        const isLastAttempt = i === attempts.length - 1
        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: 'system', content: attempt.system },
            { role: 'user', content: userContent },
          ],
          temperature: 0.2,
          ...(attempt.responseFormat ? { response_format: attempt.responseFormat } : {}),
        }

        const outcome = await postChatCompletion(fetchImpl, baseUrl, apiKey, body)

        if (outcome.kind === 'timeout' || outcome.kind === 'network-error') {
          assistantError(502, 'Der KI-Assistent ist derzeit nicht erreichbar.')
        }

        const { status, json } = outcome
        if (status === 401 || status === 403) {
          assistantError(503, 'KI-Assistent ist nicht korrekt konfiguriert.')
        }
        if (status === 429) {
          assistantError(503, 'Der KI-Assistent ist ausgelastet, bitte später erneut versuchen.')
        }
        if (!isLastAttempt && isUnsupportedResponseFormat(status)) {
          continue
        }
        if (status < 200 || status >= 300) {
          assistantError(502, 'Der KI-Assistent ist derzeit nicht erreichbar.')
        }

        return parseChatCompletionBody(json)
      }

      // Unreachable: the loop always returns or throws on its last iteration.
      assistantError(502, 'Der KI-Assistent ist derzeit nicht erreichbar.')
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
  baseUrl: string
  apiKey: string
  model: string
}

type Provider = 'openai' | 'fake' | null

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

function resolveBaseUrl(config: DeckAssistantRuntimeConfig): string {
  const trimmed = normalizeBaseUrl(config.baseUrl)
  return trimmed !== '' ? trimmed : DEFAULT_BASE_URL
}

/** Whether the caller pointed the assistant at something other than the default OpenAI endpoint. */
function hasCustomBaseUrl(config: DeckAssistantRuntimeConfig): boolean {
  const trimmed = normalizeBaseUrl(config.baseUrl)
  return trimmed !== '' && trimmed !== DEFAULT_BASE_URL
}

function resolveApiKey(config: DeckAssistantRuntimeConfig): string {
  const trimmed = (config.apiKey ?? '').trim()
  if (trimmed !== '') {
    return trimmed
  }
  return (process.env.OPENAI_API_KEY ?? '').trim()
}

function resolveModelId(config: DeckAssistantRuntimeConfig): string {
  const trimmed = (config.model ?? '').trim()
  return trimmed !== '' ? trimmed : DEFAULT_MODEL
}

function resolveProvider(config: DeckAssistantRuntimeConfig): Provider {
  const raw = (config.provider ?? '').trim().toLowerCase()
  if (raw === 'fake') {
    return 'fake'
  }
  if (raw === 'openai') {
    return 'openai'
  }
  if (raw === '') {
    // Auto: an API key (config or OPENAI_API_KEY) implies a real endpoint is
    // wanted; so does a base URL explicitly changed away from the default,
    // for keyless local servers (Ollama, LM Studio) that never carry a key.
    const hasKey = resolveApiKey(config) !== ''
    if (hasKey || hasCustomBaseUrl(config)) {
      return 'openai'
    }
  }
  return null
}

export function useDeckAssistantModel(): DeckAssistantModel | null {
  const config = useRuntimeConfig().assistant as DeckAssistantRuntimeConfig
  const provider = resolveProvider(config)

  if (provider === 'fake') {
    return createFakeModel()
  }
  if (provider === 'openai') {
    return createOpenAiCompatibleModel({
      baseUrl: resolveBaseUrl(config),
      apiKey: resolveApiKey(config),
      model: resolveModelId(config),
    })
  }
  return null
}

export function getDeckAssistantStatus(): DeckAssistantStatus {
  const config = useRuntimeConfig().assistant as DeckAssistantRuntimeConfig
  const provider = resolveProvider(config)

  if (provider === 'fake') {
    return { enabled: true, provider: 'fake', model: FAKE_MODEL_ID, baseUrl: null }
  }
  if (provider === 'openai') {
    const baseUrl = resolveBaseUrl(config)
    let host = baseUrl
    try {
      host = new URL(baseUrl).host
    }
    catch {
      // Keep the raw (already-validated-enough-to-configure) string if it
      // somehow isn't a parseable URL — still never a secret.
    }
    return { enabled: true, provider: 'openai', model: resolveModelId(config), baseUrl: host }
  }
  return { enabled: false, provider: null, model: null, baseUrl: null }
}
