// The AI deck assistant's model abstraction: a small interface the core
// logic (server/utils/deck-assistant.ts) drives, plus two implementations —
// a real model reached over any OpenAI-compatible Chat Completions endpoint,
// and a deterministic, network-free "fake" used in tests and whenever no
// provider is configured for local/dev use.
//
// The server never trusts what a model returns: `generate` hands back
// `unknown`, and every field is defensively validated by the caller.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

// --- Chat (Phase 8: tool-calling chat assistant) ------------------------------
//
// A second, independent capability of the same model abstraction: a
// multi-turn conversation with text + image input and OpenAI-style tool
// calling, streamed over SSE. Unlike `generate`, this always talks to the
// Chat Completions endpoint with `stream: true` — see
// server/utils/assistant-chat.ts for the loop that drives it.

export interface ChatTextPart { type: 'text', text: string }
export interface ChatImagePart { type: 'image_url', image_url: { url: string } }
export type ChatUserContentPart = ChatTextPart | ChatImagePart

export interface ChatAssistantToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export type ChatMessage =
  | { role: 'user', content: ChatUserContentPart[] }
  | { role: 'assistant', content: string | null, tool_calls?: ChatAssistantToolCall[] }
  | { role: 'tool', tool_call_id: string, content: string }

export interface ToolDefinition {
  type: 'function'
  function: { name: string, description: string, parameters: Record<string, unknown> }
}

export interface ChatModelInput {
  /** Stable id sent as `x-opencode-session` — the conversation id. */
  sessionId: string
  /** Overrides the configured model for this call (vision-capable model for turns with images). */
  model?: string
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
}

export interface ChatStreamHandlers {
  onTextDelta: (text: string) => void
  onToolCallDelta?: () => void
}

export interface ChatModelToolCall {
  id: string
  name: string
  /** Raw JSON string, exactly as accumulated from the stream — parsed (and validated) by the caller. */
  arguments: string
}

export interface ChatModelResult {
  text: string
  toolCalls: ChatModelToolCall[]
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'other'
}

export interface DeckAssistantModel {
  readonly id: string
  /** Returns the parsed JSON object the model produced — untrusted, unvalidated. */
  generate(input: AssistantModelInput): Promise<unknown>
  /** Multi-turn chat with tool calling, streamed. */
  chat(input: ChatModelInput, handlers: ChatStreamHandlers): Promise<ChatModelResult>
}

function assistantError(statusCode: number, message: string): never {
  throw createError({ statusCode, statusMessage: message, message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// --- Shared request plumbing (headers, package version) -----------------------
//
// OpenCode Go rejects any request (chat or generate) that lacks
// `x-opencode-session`; other providers ignore it. `User-Agent` identifies
// the app/version to whichever gateway is on the other end.

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

const PACKAGE_VERSION = resolvePackageVersion()
const USER_AGENT = `yugioh-alpha/${PACKAGE_VERSION}`

function buildRequestHeaders(apiKey: string, sessionId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-opencode-session': sessionId,
    'user-agent': USER_AGENT,
    ...(apiKey !== '' ? { authorization: `Bearer ${apiKey}` } : {}),
  }
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
  /**
   * Sent as `reasoning_effort` when set. Some OpenAI-compatible gateways
   * (e.g. OpenCode Go) require it for certain models; most ignore it.
   */
  reasoningEffort?: string
  /**
   * Used instead of `model` for a chat turn that contains an image, when set
   * (`NUXT_ASSISTANT_VISION_MODEL` / `runtimeConfig.assistant.visionModel`).
   */
  visionModel?: string
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
  sessionId: string,
  body: Record<string, unknown>,
): Promise<ChatCompletionOutcome> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildRequestHeaders(apiKey, sessionId),
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

/** Maps a status code shared by both `generate` and `chat` to the same German errors, or null if not one of those. */
function mapCommonErrorStatus(status: number): void {
  if (status === 401 || status === 403) {
    assistantError(503, 'KI-Assistent ist nicht korrekt konfiguriert.')
  }
  if (status === 429) {
    assistantError(503, 'Der KI-Assistent ist ausgelastet, bitte später erneut versuchen.')
  }
}

function mapFinishReason(raw: unknown): ChatModelResult['finishReason'] {
  return raw === 'stop' || raw === 'length' || raw === 'tool_calls' || raw === 'content_filter' ? raw : 'other'
}

/**
 * Reads a `text/event-stream` body, tolerating `data:` lines split across
 * chunk boundaries and a final `data: [DONE]`. Calls `onData` with the parsed
 * JSON of every well-formed `data:` line (malformed lines are skipped).
 */
async function readSseEvents(
  body: ReadableStream<Uint8Array> | null,
  onData: (json: unknown) => void,
): Promise<void> {
  if (!body) {
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) {
      return
    }
    const data = trimmed.slice(5).trim()
    if (data === '' || data === '[DONE]') {
      return
    }
    try {
      onData(JSON.parse(data))
    }
    catch {
      // Malformed line — ignore and keep reading the stream.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      consumeLine(line)
    }
  }

  if (buffer !== '') {
    consumeLine(buffer)
  }
}

export function createOpenAiCompatibleModel(options: CreateOpenAiCompatibleModelOptions): DeckAssistantModel {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const apiKey = options.apiKey ?? ''
  const model = options.model
  const reasoningEffort = (options.reasoningEffort ?? '').trim()
  const visionModel = (options.visionModel ?? '').trim()
  const fetchImpl = options.fetch ?? fetch

  return {
    id: model,
    async generate(input: AssistantModelInput): Promise<unknown> {
      const userContent = `${input.context}\n\n${input.prompt}`
      const sessionId = randomUUID()

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
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          ...(attempt.responseFormat ? { response_format: attempt.responseFormat } : {}),
        }

        const outcome = await postChatCompletion(fetchImpl, baseUrl, apiKey, sessionId, body)

        if (outcome.kind === 'timeout' || outcome.kind === 'network-error') {
          assistantError(502, 'Der KI-Assistent ist derzeit nicht erreichbar.')
        }

        const { status, json } = outcome
        mapCommonErrorStatus(status)
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

    async chat(input: ChatModelInput, handlers: ChatStreamHandlers): Promise<ChatModelResult> {
      const hasImage = input.messages.some(message =>
        message.role === 'user' && message.content.some(part => part.type === 'image_url'))
      const modelToUse = input.model?.trim() || (hasImage && visionModel ? visionModel : model)

      const body: Record<string, unknown> = {
        model: modelToUse,
        messages: [{ role: 'system', content: input.system }, ...input.messages],
        stream: true,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: 'auto' } : {}),
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { ...buildRequestHeaders(apiKey, input.sessionId), accept: 'text/event-stream' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      }
      catch (error) {
        clearTimeout(timeoutId)
        if (error instanceof Error && error.name === 'AbortError') {
          assistantError(502, 'Der KI-Assistent ist derzeit nicht erreichbar.')
        }
        assistantError(502, 'Der KI-Assistent ist derzeit nicht erreichbar.')
      }

      if (response.status < 200 || response.status >= 300) {
        clearTimeout(timeoutId)
        mapCommonErrorStatus(response.status)
        assistantError(502, 'Der KI-Assistent ist derzeit nicht erreichbar.')
      }

      let text = ''
      let finishReason: ChatModelResult['finishReason'] = 'other'
      const toolCallsByIndex = new Map<number, ChatModelToolCall>()

      try {
        await readSseEvents(response.body, (json) => {
          if (!isRecord(json)) {
            return
          }
          const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
          if (!isRecord(choice)) {
            return
          }

          const delta = choice.delta
          if (isRecord(delta)) {
            if (typeof delta.content === 'string' && delta.content !== '') {
              text += delta.content
              handlers.onTextDelta(delta.content)
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const rawCall of delta.tool_calls) {
                if (!isRecord(rawCall) || typeof rawCall.index !== 'number') {
                  continue
                }
                const existing = toolCallsByIndex.get(rawCall.index) ?? { id: '', name: '', arguments: '' }
                if (typeof rawCall.id === 'string' && rawCall.id !== '') {
                  existing.id = rawCall.id
                }
                const fn = rawCall.function
                if (isRecord(fn)) {
                  if (typeof fn.name === 'string' && fn.name !== '') {
                    existing.name = fn.name
                  }
                  if (typeof fn.arguments === 'string') {
                    existing.arguments += fn.arguments
                  }
                }
                toolCallsByIndex.set(rawCall.index, existing)
                handlers.onToolCallDelta?.()
              }
            }
          }

          if (typeof choice.finish_reason === 'string') {
            finishReason = mapFinishReason(choice.finish_reason)
          }
        })
      }
      finally {
        clearTimeout(timeoutId)
      }

      const toolCalls = [...toolCallsByIndex.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call)

      return { text, toolCalls, finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason }
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

// --- Fake chat (deterministic, scripted tool-calling for tests/E2E) ----------
//
// Drives a small, fixed script off the *last* user message's text/image, and
// whether a tool has already run earlier in the same turn (a 'tool' message
// after that last user message) — see the "Fake model" decision in
// docs/adr/0010-chat-assistant-with-tools.md.

let fakeToolCallCounter = 0

function nextFakeToolCallId(): string {
  fakeToolCallCounter += 1
  return `fake-call-${fakeToolCallCounter}`
}

function fakeUserText(message: ChatMessage): string {
  return message.role === 'user'
    ? message.content.filter((part): part is ChatTextPart => part.type === 'text').map(part => part.text).join(' ')
    : ''
}

function fakeHasImage(message: ChatMessage): boolean {
  return message.role === 'user' && message.content.some(part => part.type === 'image_url')
}

function findLastIndexByRole(messages: ChatMessage[], role: ChatMessage['role']): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === role) {
      return i
    }
  }
  return -1
}

/** Extracts the search term from "suche/such/finde [nach] <term>" — falls back to the whole text. */
function fakeExtractSearchQuery(text: string): string {
  const match = text.match(/(?:suche|such|finde)\s*(?:nach\s+)?(.+)$/i)
  const query = match?.[1]?.trim()
  return query && query !== '' ? query : text.trim()
}

function fakeExtractQuantity(text: string): number {
  const match = text.match(/\d+/)
  return match ? Math.max(1, Number(match[0])) : 1
}

/** The first card-like object (`{ id, name, ... }`) in the most recent tool result, if any. */
function fakeFindLastSearchResultCard(messages: ChatMessage[]): { id: number, name: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role !== 'tool') {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(message.content)
      if (Array.isArray(parsed) && parsed.length > 0 && isRecord(parsed[0]) && typeof parsed[0].id === 'number') {
        const name = typeof parsed[0].name === 'string' ? parsed[0].name : `#${parsed[0].id}`
        return { id: parsed[0].id, name }
      }
    }
    catch {
      // Not a JSON array of cards — keep scanning further back.
    }
  }
  return null
}

function fakeToolCallResult(name: string, args: Record<string, unknown>, text = ''): ChatModelResult {
  return {
    text,
    toolCalls: [{ id: nextFakeToolCallId(), name, arguments: JSON.stringify(args) }],
    finishReason: 'tool_calls',
  }
}

function fakeTextResult(text: string): ChatModelResult {
  return { text, toolCalls: [], finishReason: 'stop' }
}

async function fakeChat(input: ChatModelInput, handlers: ChatStreamHandlers): Promise<ChatModelResult> {
  const messages = input.messages
  const lastUserIndex = findLastIndexByRole(messages, 'user')
  const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined
  const alreadyRanToolThisTurn = lastUserIndex >= 0
    && messages.slice(lastUserIndex + 1).some(message => message.role === 'tool')

  const text = lastUser ? fakeUserText(lastUser) : ''
  const lower = text.toLowerCase()
  const isSearchIntent = lower.includes('suche') || lower.includes('such') || lower.includes('finde')
  const isAddIntent = lower.includes('hinzufügen') || lower.includes('füge')
  const hasImage = lastUser ? fakeHasImage(lastUser) : false

  let result: ChatModelResult

  if (alreadyRanToolThisTurn) {
    if (isAddIntent) {
      result = fakeTextResult('Ich habe einen Vorschlag angelegt.')
    }
    else {
      const lastToolMessage = messages[findLastIndexByRole(messages, 'tool')]
      let count = 0
      let names: string[] = []
      if (lastToolMessage?.role === 'tool') {
        try {
          const parsed: unknown = JSON.parse(lastToolMessage.content)
          if (Array.isArray(parsed)) {
            count = parsed.length
            names = parsed.flatMap(item => (isRecord(item) && typeof item.name === 'string') ? [item.name] : [])
          }
        }
        catch {
          // Not a JSON array — report zero results.
        }
      }
      result = fakeTextResult(`Ich habe ${count} ${count === 1 ? 'Karte' : 'Karten'} gefunden: ${names.join(', ')}`)
    }
  }
  else if (hasImage) {
    result = {
      text: 'Auf dem Bild sehe ich: Dark Magician.',
      toolCalls: [{ id: nextFakeToolCallId(), name: 'search_catalog', arguments: JSON.stringify({ query: 'Dark Magician' }) }],
      finishReason: 'tool_calls',
    }
  }
  else if (isSearchIntent) {
    result = fakeToolCallResult('search_catalog', { query: fakeExtractSearchQuery(text) })
  }
  else if (isAddIntent) {
    const card = fakeFindLastSearchResultCard(messages)
    result = card
      ? fakeToolCallResult('add_to_inventory', { items: [{ catalogCardId: card.id, quantity: fakeExtractQuantity(text) }] })
      : fakeTextResult('Ich habe keine passende Karte gefunden.')
  }
  else {
    result = fakeTextResult(`Testantwort: ${text}`)
  }

  if (result.text !== '') {
    handlers.onTextDelta(result.text)
  }
  if (result.toolCalls.length > 0) {
    handlers.onToolCallDelta?.()
  }

  return result
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
    chat: fakeChat,
  }
}

// --- Configuration resolution -------------------------------------------------

export interface DeckAssistantRuntimeConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort: string
  /** NUXT_ASSISTANT_VISION_MODEL — used for chat turns with images; '' = use `model`. */
  visionModel: string
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

function resolveReasoningEffort(config: DeckAssistantRuntimeConfig): string | undefined {
  const trimmed = (config.reasoningEffort ?? '').trim()
  return trimmed !== '' ? trimmed : undefined
}

function resolveModelId(config: DeckAssistantRuntimeConfig): string {
  const trimmed = (config.model ?? '').trim()
  return trimmed !== '' ? trimmed : DEFAULT_MODEL
}

/** '' when unset (chat turns with images then use `model` as-is). */
function resolveVisionModel(config: DeckAssistantRuntimeConfig): string {
  return (config.visionModel ?? '').trim()
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
      reasoningEffort: resolveReasoningEffort(config),
      visionModel: resolveVisionModel(config) || undefined,
    })
  }
  return null
}

export function getDeckAssistantStatus(): DeckAssistantStatus {
  const config = useRuntimeConfig().assistant as DeckAssistantRuntimeConfig
  const provider = resolveProvider(config)

  if (provider === 'fake') {
    return { enabled: true, provider: 'fake', model: FAKE_MODEL_ID, baseUrl: null, chat: true, vision: true, visionModel: null }
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
    return {
      enabled: true,
      provider: 'openai',
      model: resolveModelId(config),
      baseUrl: host,
      chat: true,
      // Every provider reachable here (a real OpenAI-compatible endpoint, or
      // the fake) is treated as vision-capable — see ADR 0010.
      vision: true,
      visionModel: visionModel !== '' ? visionModel : null,
    }
  }
  return { enabled: false, provider: null, model: null, baseUrl: null, chat: false, vision: false, visionModel: null }
}
