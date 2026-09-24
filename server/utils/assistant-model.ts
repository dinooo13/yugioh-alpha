// The chat assistant's model on the AI SDK (docs/adr/0020-assistant-on-the-ai-sdk.md):
// the app-level configuration (provider auto-detection, OPENAI_API_KEY
// fallback, defaults, vision model — ADR 0009/0010), the language model the
// turn engine (server/utils/assistant-turn.ts) streams from, the
// deterministic fake used by tests and E2E, and the mapping of SDK errors to
// our error codes (ADR 0014).
//
// The real model is `@ai-sdk/openai-compatible` against any Chat Completions
// endpoint (OpenAI, OpenRouter, Ollama, LM Studio, OpenCode Go/Zen, ...).
// OpenCode Go rejects requests without `x-opencode-session`; the turn sends
// it per call (the conversation id). `User-Agent` identifies the app.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createError } from 'h3'
import { AISDKError, APICallError, InvalidToolInputError, NoSuchToolError, RetryError, simulateReadableStream } from 'ai'
import type { LanguageModel, streamText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type { AssistantStatus } from '../../shared/assistant-chat'
import { TOOL_TEXT } from './assistant-prompts'

// --- Configuration resolution -------------------------------------------------

export interface DeckAssistantRuntimeConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort: string
  /** NUXT_ASSISTANT_VISION_MODEL — used for chat turns with images; '' = use `model`. */
  visionModel: string
  /** NUXT_ASSISTANT_MODELS — comma-separated model ids the user may pick from; '' = only `model`. */
  models?: string
}

export type AssistantProvider = 'openai' | 'fake' | null

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_MODEL = 'gpt-4o-mini'
export const FAKE_MODEL_ID = 'fake'

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

export function resolveBaseUrl(config: DeckAssistantRuntimeConfig): string {
  const trimmed = normalizeBaseUrl(config.baseUrl)
  return trimmed !== '' ? trimmed : DEFAULT_BASE_URL
}

/** Whether the caller pointed the assistant at something other than the default OpenAI endpoint. */
function hasCustomBaseUrl(config: DeckAssistantRuntimeConfig): boolean {
  const trimmed = normalizeBaseUrl(config.baseUrl)
  return trimmed !== '' && trimmed !== DEFAULT_BASE_URL
}

export function resolveApiKey(config: DeckAssistantRuntimeConfig): string {
  const trimmed = (config.apiKey ?? '').trim()
  if (trimmed !== '') {
    return trimmed
  }
  return (process.env.OPENAI_API_KEY ?? '').trim()
}

export function resolveReasoningEffort(config: DeckAssistantRuntimeConfig): string | undefined {
  const trimmed = (config.reasoningEffort ?? '').trim()
  return trimmed !== '' ? trimmed : undefined
}

export function resolveModelId(config: DeckAssistantRuntimeConfig): string {
  const trimmed = (config.model ?? '').trim()
  return trimmed !== '' ? trimmed : DEFAULT_MODEL
}

/** '' when unset (chat turns with images then use `model` as-is). */
export function resolveVisionModel(config: DeckAssistantRuntimeConfig): string {
  return (config.visionModel ?? '').trim()
}

/**
 * The models the user may pick from (the owner's allowlist, `NUXT_ASSISTANT_MODELS`,
 * comma-separated, passed to the provider as they are) and the default one:
 * `NUXT_ASSISTANT_MODEL` when it is on the list, else the list's first entry.
 * Without a list, only the configured model. `fallback` is the model id when
 * nothing is configured at all.
 */
export function resolveModelChoice(config: DeckAssistantRuntimeConfig, fallback = resolveModelId(config)): { models: string[], defaultModel: string } {
  const listed = [...new Set((config.models ?? '').split(',').map(id => id.trim()).filter(id => id !== ''))]
  if (listed.length === 0) {
    return { models: [fallback], defaultModel: fallback }
  }
  const configured = (config.model ?? '').trim()
  return { models: listed, defaultModel: listed.includes(configured) ? configured : listed[0]! }
}

export function resolveProvider(config: DeckAssistantRuntimeConfig): AssistantProvider {
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

export function useAssistantRuntimeConfig(): DeckAssistantRuntimeConfig {
  return useRuntimeConfig().assistant as DeckAssistantRuntimeConfig
}

export function getAssistantStatus(): AssistantStatus {
  const config = useAssistantRuntimeConfig()
  const provider = resolveProvider(config)

  if (provider === 'fake') {
    // The fake answers the same whichever id is picked; a list makes the picker testable.
    const { models, defaultModel } = resolveModelChoice(config, FAKE_MODEL_ID)
    return { enabled: true, provider: 'fake', model: defaultModel, models, defaultModel, baseUrl: null, chat: true, vision: true, visionModel: null }
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
    const visionModel = resolveVisionModel(config)
    const { models, defaultModel } = resolveModelChoice(config)
    return {
      enabled: true,
      provider: 'openai',
      model: defaultModel,
      models,
      defaultModel,
      baseUrl: host,
      chat: true,
      // Every provider reachable here (a real OpenAI-compatible endpoint, or
      // the fake) is treated as vision-capable — see ADR 0010.
      vision: true,
      visionModel: visionModel !== '' ? visionModel : null,
    }
  }
  return { enabled: false, provider: null, model: null, models: [], defaultModel: null, baseUrl: null, chat: false, vision: false, visionModel: null }
}

// --- Request identity (User-Agent) --------------------------------------------

function resolvePackageVersion(): string {
  if (process.env.npm_package_version) {
    return process.env.npm_package_version
  }
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  }
  catch {
    return '0.0.0'
  }
}

export const ASSISTANT_USER_AGENT = `ygo-alpha/${resolvePackageVersion()}`

// --- The language model --------------------------------------------------------

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

/** The provider name under which `providerOptions` are read (`createOpenAICompatible({ name })`). */
export const ASSISTANT_PROVIDER_NAME = 'assistant'

export interface AssistantLanguageModel {
  /** The model id picked for the turn (`fake` for the fake, unless a list is configured). */
  readonly id: string
  /** The model for one turn: the vision model for a turn with images, when one is configured. */
  modelFor: (hasImages: boolean) => LanguageModel
  /** The id of `modelFor(hasImages)` — stored with the answer (`metadata.model`). Defaults to `id`. */
  modelIdFor?: (hasImages: boolean) => string
  /** Per-call provider options (`reasoning_effort`), when configured. */
  readonly providerOptions?: ProviderOptions
}

export interface CreateOpenAiCompatibleLanguageModelOptions {
  baseUrl: string
  apiKey?: string
  model: string
  /** Sent as `reasoning_effort` when set; some gateways (e.g. OpenCode Go) require it for certain models. */
  reasoningEffort?: string
  /** Used instead of `model` for a turn that contains an image, when set. */
  visionModel?: string
  /** Injectable for tests. */
  fetch?: typeof fetch
}

export function createOpenAiCompatibleLanguageModel(options: CreateOpenAiCompatibleLanguageModelOptions): AssistantLanguageModel {
  const apiKey = (options.apiKey ?? '').trim()
  const reasoningEffort = (options.reasoningEffort ?? '').trim()
  const visionModel = (options.visionModel ?? '').trim()
  const provider = createOpenAICompatible({
    name: ASSISTANT_PROVIDER_NAME,
    baseURL: options.baseUrl.replace(/\/+$/, ''),
    // Keyless local servers (Ollama, LM Studio): no Authorization header at all.
    ...(apiKey !== '' ? { apiKey } : {}),
    headers: { 'user-agent': ASSISTANT_USER_AGENT },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })

  const modelIdFor = (hasImages: boolean) => hasImages && visionModel !== '' ? visionModel : options.model
  return {
    id: options.model,
    modelFor: hasImages => provider.chatModel(modelIdFor(hasImages)),
    modelIdFor,
    ...(reasoningEffort !== '' ? { providerOptions: { [ASSISTANT_PROVIDER_NAME]: { reasoningEffort } } } : {}),
  }
}

/**
 * The model the user picked (`modelId`, one of the configured models) or the
 * default one; null when the assistant isn't configured (503
 * `assistant_not_configured`). Throws 400 `assistant_model_not_allowed` for
 * a model that isn't on the list.
 */
export function useAssistantLanguageModel(modelId?: string): AssistantLanguageModel | null {
  const config = useAssistantRuntimeConfig()
  const provider = resolveProvider(config)

  if (provider === 'fake') {
    return createFakeLanguageModel(pickModel(resolveModelChoice(config, FAKE_MODEL_ID), modelId))
  }
  if (provider === 'openai') {
    return createOpenAiCompatibleLanguageModel({
      baseUrl: resolveBaseUrl(config),
      apiKey: resolveApiKey(config),
      model: pickModel(resolveModelChoice(config), modelId),
      reasoningEffort: resolveReasoningEffort(config),
      visionModel: resolveVisionModel(config) || undefined,
    })
  }
  return null
}

/** `requested` when it is one of `choice.models`, the default when nothing was requested; else 400 `assistant_model_not_allowed`. */
export function pickModel(choice: { models: string[], defaultModel: string }, requested: string | undefined): string {
  if (requested === undefined) {
    return choice.defaultModel
  }
  if (!choice.models.includes(requested)) {
    throw createError({ statusCode: 400, statusMessage: 'This model is not available', data: { code: 'assistant_model_not_allowed' } })
  }
  return requested
}

// --- Errors ---------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The error code (ADR 0014, `errors.api.<code>`) the UI shows for an error
 * that ended a turn: the provider's HTTP status (401/403 → misconfigured,
 * 429 → busy, anything else → unreachable), a network failure or step
 * timeout (unreachable), an h3 error's `data.code`, else `unexpected`.
 */
export function assistantErrorCode(error: unknown): string {
  let cause = error
  if (RetryError.isInstance(cause)) {
    cause = cause.lastError
  }
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode
    if (status === 401 || status === 403) {
      return 'assistant_misconfigured'
    }
    if (status === 429) {
      return 'assistant_busy'
    }
    return 'assistant_unreachable'
  }
  if (isRecord(cause) && isRecord(cause.data) && typeof cause.data.code === 'string' && cause.data.code !== '') {
    return cause.data.code
  }
  if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
    return 'assistant_unreachable'
  }
  // Any other SDK error (an unparseable or truncated provider stream, a
  // missing finish reason, ...) means the provider didn't deliver.
  if (AISDKError.isInstance(cause)) {
    return 'assistant_unreachable'
  }
  return 'unexpected'
}

/**
 * A tool call that failed; thrown from a tool's `execute` (and returned by
 * its input validation) with the technical English message the model reads.
 * The AI SDK hands a failed call's error to the model as JSON, so `toJSON`
 * makes that `{ "error": "<message>" }` — the same shape as the stored tool
 * results of legacy conversations — instead of an empty `{}`.
 */
export class AssistantToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssistantToolError'
  }

  toJSON(): { error: string } {
    return { error: this.message }
  }
}

const TOOL_ERROR_PREFIX = 'AssistantToolError: '
const SDK_TOOL_ERROR_PATTERN = /^AI_(?:InvalidToolInputError|NoSuchToolError)\b/

/**
 * Whether an error belongs to one tool call (the model reads it and the turn
 * goes on) rather than to the turn. The SDK records an invalid or unknown
 * tool call's error as the error's string (`AI_InvalidToolInputError: …`).
 */
export function isToolCallError(error: unknown): boolean {
  return error instanceof AssistantToolError
    || InvalidToolInputError.isInstance(error)
    || NoSuchToolError.isInstance(error)
    || (typeof error === 'string' && (SDK_TOOL_ERROR_PATTERN.test(error) || error.startsWith(TOOL_ERROR_PREFIX)))
}

/** `toolErrorTextFromJson` for an error the SDK recorded as a string: our message where it is nested in it, else a generic text per SDK error kind. */
function toolErrorTextFromString(error: string): string {
  const index = error.lastIndexOf(TOOL_ERROR_PREFIX)
  if (index >= 0) {
    return error.slice(index + TOOL_ERROR_PREFIX.length).trim()
  }
  if (error.startsWith('AI_InvalidToolInputError')) {
    return TOOL_TEXT.invalidArguments
  }
  const unknownTool = error.match(/^AI_NoSuchToolError\b.*?tool '([^']+)'/)
  if (unknownTool) {
    return TOOL_TEXT.unknownTool(unknownTool[1]!)
  }
  return TOOL_TEXT.unexpectedError
}

/** The first `error` string in a (JSON-serialized) tool error, depth first through `cause`. */
function findErrorText(value: unknown, depth = 0): string | null {
  if (!isRecord(value) || depth > 5) {
    return null
  }
  if (typeof value.error === 'string' && value.error !== '') {
    return value.error
  }
  return findErrorText(value.cause, depth + 1)
}

/**
 * The English text of a failed tool call, from the error as the AI SDK
 * serializes it for the model (`JSON.stringify`): our own message where
 * there is one (`AssistantToolError`, also as the cause of an invalid-input
 * error), else a generic text per SDK error kind.
 */
export function toolErrorTextFromJson(value: unknown): string {
  const text = findErrorText(value)
  if (text !== null) {
    return text
  }
  if (isRecord(value)) {
    if (value.name === 'AI_InvalidToolInputError') {
      return TOOL_TEXT.invalidArguments
    }
    if (value.name === 'AI_NoSuchToolError' && typeof value.toolName === 'string') {
      return TOOL_TEXT.unknownTool(value.toolName)
    }
  }
  return TOOL_TEXT.unexpectedError
}

/** The English text of a failed tool call, for the error as thrown or as the SDK recorded it — the same text in the stream, the stored part and the model's view. */
export function toolErrorText(error: unknown): string {
  if (typeof error === 'string') {
    return toolErrorTextFromString(error)
  }
  let json: unknown
  try {
    json = JSON.parse(JSON.stringify(error) ?? 'null')
  }
  catch {
    json = null
  }
  return toolErrorTextFromJson(json)
}

/**
 * `onError` of the UI message stream: a failed tool call's part gets its
 * English error text (`errorText`, shown in the chip's detail), a turn-ending
 * error chunk gets the error code the UI translates.
 */
export function assistantStreamErrorText(error: unknown): string {
  return isToolCallError(error) ? toolErrorText(error) : assistantErrorCode(error)
}

// --- Fake model (deterministic, no network) -------------------------------------
//
// Drives a small, fixed script off the *last* user message's text/image, and
// whether a tool has already run earlier in the same turn (a 'tool' message
// after that last user message) — see the "Fake model" decision in
// docs/adr/0010-chat-assistant-with-tools.md, ported to the AI SDK's
// language model interface (ADR 0020). `NUXT_ASSISTANT_PROVIDER=fake`.

type FakeCallOptions = Parameters<MockLanguageModelV4['doStream']>[0]
type FakePromptMessage = FakeCallOptions['prompt'][number]
type FakeStreamPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer PART> ? PART : never

interface FakeToolCall { toolName: string, input: Record<string, unknown> | string }
interface FakeTurn {
  text: string
  toolCalls: FakeToolCall[]
  /** Streams the text word by word with a delay (the cancel test needs an answer that takes a while). */
  slow?: boolean
}

let fakeToolCallCounter = 0

function nextFakeToolCallId(): string {
  fakeToolCallCounter += 1
  return `fake-call-${fakeToolCallCounter}`
}

/** The system prompt of a call (`instructions`), as the model receives it. */
function fakeSystemText(prompt: FakePromptMessage[]): string {
  return prompt.flatMap(message => message.role === 'system' ? [message.content] : []).join('\n\n')
}

function fakeUserText(message: FakePromptMessage | undefined): string {
  if (message?.role !== 'user') {
    return ''
  }
  return message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(' ')
}

function fakeHasImage(message: FakePromptMessage | undefined): boolean {
  return message?.role === 'user' && message.content.some(part => part.type === 'file')
}

function findLastIndexByRole(prompt: FakePromptMessage[], role: FakePromptMessage['role']): number {
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i]!.role === role) {
      return i
    }
  }
  return -1
}

/** The value of a tool result the model reads (`json`, or `text` that parses as JSON). */
function fakeToolResultValue(message: FakePromptMessage | undefined): unknown {
  if (message?.role !== 'tool') {
    return undefined
  }
  const part = [...message.content].reverse().find(candidate => candidate.type === 'tool-result')
  if (!part || part.type !== 'tool-result') {
    return undefined
  }
  const output = part.output
  if (output.type === 'json' || output.type === 'error-json') {
    return output.value
  }
  if (output.type === 'text' || output.type === 'error-text') {
    try {
      return JSON.parse(output.value)
    }
    catch {
      return output.value
    }
  }
  return undefined
}

/**
 * The result array of a tool outcome, whether it's the bare array a few
 * tools still return, or the `{ items, truncated, total? }` envelope the
 * capped read tools use (assistant-tools.ts `capResult`) — `null` if
 * `parsed` is neither.
 */
function fakeResultItems(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (isRecord(parsed) && Array.isArray(parsed.items)) {
    return parsed.items
  }
  return null
}

// Matches "such"/"suche"/"suchen"/"finde" as whole words only — `lower.includes('such')`
// used to also fire on "versuche", "untersuche" or "Suchtkarte".
const FAKE_SEARCH_INTENT_PATTERN = /\bsuch(?:e|en)?\b|\bfinde\b/i

/** Extracts the search term after "suche/such/finde [nach] <term>" — falls back to the last word(s) rather than the whole sentence when the keyword itself can't be isolated. */
function fakeExtractSearchQuery(text: string): string {
  const match = text.match(/\b(?:such(?:e|en)?|finde)\b\s*(?:nach\s+)?(.+)$/i)
  const query = match?.[1]?.trim()
  if (query && query !== '') {
    return query
  }
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.slice(-3).join(' ')
}

function fakeExtractQuantity(text: string): number {
  const match = text.match(/\d+/)
  return match ? Math.max(1, Number(match[0])) : 1
}

/** The first card-like object (`{ id, name, ... }`) in the most recent tool result, if any. */
function fakeFindLastSearchResultCard(prompt: FakePromptMessage[]): { id: number, name: string } | null {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const items = fakeResultItems(fakeToolResultValue(prompt[i]))
    const first = items?.[0]
    if (items && items.length > 0 && isRecord(first) && typeof first.id === 'number') {
      const name = typeof first.name === 'string' ? first.name : `#${first.id}`
      return { id: first.id, name }
    }
  }
  return null
}

const FAKE_DECK_INTENT_PATTERN = /\bdeck\b/i
const FAKE_ADD_INTENT_PATTERN_EN = /\badd\b/i
/** Test trigger (#54): always calls search_catalog with empty arguments; answers in text once tools are switched off. */
const FAKE_EMPTY_ARGUMENTS_TRIGGER = 'leere argumente'
/** Test trigger (#54): writes the tool call into the answer text; makes the real call once the corrective hint is in the system prompt. */
const FAKE_TEXT_TOOL_CALL_TRIGGER = 'text-werkzeug'
/** Test trigger: a long answer streamed slowly, so "Abbrechen" can stop it midway. */
const FAKE_SLOW_TRIGGER = 'langsame antwort'
/** Per word of the slow answer. */
const FAKE_SLOW_CHUNK_DELAY_MS = 250
const FAKE_SLOW_TEXT = Array.from({ length: 60 }, (_, index) => `Wort${index + 1}`).join(' ')

/**
 * Proves the linked deck's context block (assistant-chat.ts
 * `buildDeckContextBlock`) reached the system prompt: answers with the deck
 * name and card total read back from it.
 */
function fakeDeckContextAnswer(system: string): string {
  const name = system.match(/^Deck name: (.*)$/m)?.[1] ?? '?'
  const counts = system.match(/^Counts: Main (\d+) · Extra (\d+) · Side (\d+)$/m)
  const total = counts ? Number(counts[1]) + Number(counts[2]) + Number(counts[3]) : 0
  return `Kontext-Deck: ${name} (${total} Karten)`
}

function fakeText(text: string): FakeTurn {
  return { text, toolCalls: [] }
}

function fakeToolCall(toolName: string, input: Record<string, unknown> | string, text = ''): FakeTurn {
  return { text, toolCalls: [{ toolName, input }] }
}

/** What the fake model answers to one call: the ported script of the former engine plus the two #54 triggers. */
export function fakeTurn(options: Pick<FakeCallOptions, 'prompt' | 'toolChoice'>): FakeTurn {
  const prompt = options.prompt
  const system = fakeSystemText(prompt)
  const lastUserIndex = findLastIndexByRole(prompt, 'user')
  const lastUser = lastUserIndex >= 0 ? prompt[lastUserIndex] : undefined
  const afterLastUser = lastUserIndex >= 0 ? prompt.slice(lastUserIndex + 1) : []
  const alreadyRanToolThisTurn = afterLastUser.some(message => message.role === 'tool')

  const text = fakeUserText(lastUser)
  const lower = text.toLowerCase()

  if (lower.includes(FAKE_EMPTY_ARGUMENTS_TRIGGER)) {
    return options.toolChoice?.type === 'none'
      ? fakeText('Ich kann das Werkzeug gerade nicht nutzen.')
      : fakeToolCall('search_catalog', '')
  }
  if (lower.includes(FAKE_SLOW_TRIGGER)) {
    return { text: FAKE_SLOW_TEXT, toolCalls: [], slow: true }
  }
  if (lower.includes(FAKE_TEXT_TOOL_CALL_TRIGGER)) {
    if (alreadyRanToolThisTurn) {
      const items = fakeResultItems(fakeToolResultValue(prompt[findLastIndexByRole(prompt, 'tool')])) ?? []
      return fakeText(`Ich habe ${items.length} ${items.length === 1 ? 'Karte' : 'Karten'} gefunden.`)
    }
    return system.includes(TOOL_TEXT.textWrittenToolCallHint)
      ? fakeToolCall('search_catalog', { query: 'Dark Magician' })
      : fakeText('search_catalog {"query":"Dark Magician"}')
  }

  const isSearchIntent = FAKE_SEARCH_INTENT_PATTERN.test(lower)
  // German trigger words, plus English "add" for English-UI tests.
  const isAddIntent = lower.includes('hinzufügen') || lower.includes('füge') || FAKE_ADD_INTENT_PATTERN_EN.test(lower)

  if (alreadyRanToolThisTurn) {
    if (isAddIntent) {
      return fakeText('Ich habe einen Vorschlag angelegt.')
    }
    const items = fakeResultItems(fakeToolResultValue(prompt[findLastIndexByRole(prompt, 'tool')]))
    const count = items?.length ?? 0
    const names = (items ?? []).flatMap(item => (isRecord(item) && typeof item.name === 'string') ? [item.name] : [])
    return fakeText(`Ich habe ${count} ${count === 1 ? 'Karte' : 'Karten'} gefunden: ${names.join(', ')}`)
  }
  if (fakeHasImage(lastUser)) {
    return fakeToolCall('search_catalog', { query: 'Dark Magician' }, 'Auf dem Bild sehe ich: Dark Magician.')
  }
  if (isSearchIntent) {
    return fakeToolCall('search_catalog', { query: fakeExtractSearchQuery(text) })
  }
  if (isAddIntent) {
    const card = fakeFindLastSearchResultCard(prompt)
    return card
      ? fakeToolCall('add_to_inventory', { items: [{ catalogCardId: card.id, quantity: fakeExtractQuantity(text) }] })
      : fakeText('Ich habe keine passende Karte gefunden.')
  }
  if (FAKE_DECK_INTENT_PATTERN.test(text) && system.includes('Deck ID:')) {
    return fakeText(fakeDeckContextAnswer(system))
  }
  return fakeText(`Testantwort: ${text}`)
}

const FAKE_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

/** One fake answer as a language-model stream (the V4 stream parts a real provider produces). */
export function fakeStreamParts(turn: FakeTurn): FakeStreamPart[] {
  const parts: FakeStreamPart[] = [{ type: 'stream-start', warnings: [] }]
  if (turn.text !== '') {
    const deltas = turn.slow ? turn.text.split(/(?<= )/) : [turn.text]
    parts.push(
      { type: 'text-start', id: 'fake-text' },
      ...deltas.map(delta => ({ type: 'text-delta' as const, id: 'fake-text', delta })),
      { type: 'text-end', id: 'fake-text' },
    )
  }
  for (const call of turn.toolCalls) {
    parts.push({
      type: 'tool-call',
      toolCallId: nextFakeToolCallId(),
      toolName: call.toolName,
      input: typeof call.input === 'string' ? call.input : JSON.stringify(call.input),
    })
  }
  const toolCalls = turn.toolCalls.length > 0
  parts.push({
    type: 'finish',
    finishReason: { unified: toolCalls ? 'tool-calls' : 'stop', raw: toolCalls ? 'tool_calls' : 'stop' },
    usage: FAKE_USAGE,
  })
  return parts
}

/** `id`: the model id the fake reports (and the answer stores) — its script is the same for every id. */
export function createFakeLanguageModel(id: string = FAKE_MODEL_ID): AssistantLanguageModel {
  const model = new MockLanguageModelV4({
    provider: 'fake',
    modelId: FAKE_MODEL_ID,
    doStream: async (options) => {
      const turn = fakeTurn(options)
      return {
        stream: simulateReadableStream({
          chunks: fakeStreamParts(turn),
          initialDelayInMs: null,
          chunkDelayInMs: turn.slow ? FAKE_SLOW_CHUNK_DELAY_MS : null,
        }),
      }
    },
  })
  return { id, modelFor: () => model }
}
